/**
 * Owns every autumnplot-gl layer on the map. React code hands it data; it
 * creates the plot components the first time and afterwards only swaps the
 * field data, which is what keeps time stepping fast.
 */
import {
  Barbs, Contour, ContourFill, ContourLabels, LambertGrid, PlotLayer, Raster, RawScalarField, RawVectorField,
  type PlotComponent,
} from '../vendor/apgl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { UNCERTAINTY_COLOR } from '../config/ptypeStyle';
import type { HrrrGridInfo } from '../data/hrrr';
import type { PtypeFrame } from '../data/ptype';
import { splitContourLevels } from '../fields/gridops';
import type { FieldData, FieldDef } from '../fields/registry';
import type { GridDef } from '../geo/lambert';
import { isLowMemoryDevice } from '../config/device';
import { toFloat16 } from './float16';
import { ANCHOR_FILLS, ANCHOR_LINES, LABEL_FONT } from './style';
import { PTYPE_CMAP, dominantField } from './ptypeField';

type Comp = PlotComponent<MapLibreMap>;
type AnyGrid = LambertGrid;

interface Slot {
  key: string;
  layerIds: string[];
  update(data: unknown): Promise<void>;
}

const HRRR_RADIUS = 6371229;

/**
 * Prebuilt hours kept per field; the oldest is dropped beyond this. A 48-hour run plus slack on a desktop;
 * a dozen on phones and tablets, where each hour is several megabytes of graphics memory.
 */
const MAX_PREBUILT_HOURS = isLowMemoryDevice() ? 12 : 64;

/** Resolve once `ready()` is true; plot components finish their GPU upload a little after `onAdd` returns. */
async function until(ready: () => boolean, timeoutMs = 20000): Promise<void> {
  const started = performance.now();
  while (!ready()) {
    if (performance.now() - started > timeoutMs) throw new Error('Timed out building a map layer');
    await new Promise((r) => setTimeout(r, 15));
  }
}

/**
 * A MapLibre custom layer holding one finished plot component per key (run and
 * forecast hour) and drawing whichever is active. autumnplot-gl's own
 * MultiPlotLayer does the same but cannot forget a key, and a run's worth of
 * hours has to be released when the user moves on.
 */
class KeyedLayer {
  readonly type = 'custom' as const;
  private readonly comps = new Map<string, Comp>();
  private active: string | null = null;
  private map: MapLibreMap | null = null;
  private gl: WebGLRenderingContext | null = null;

  /** `minZoom`: draw only from this map zoom inwards (used for the in-between contour lines). */
  constructor(readonly id: string, private readonly minZoom = 0) {}

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext) {
    this.map = map;
    this.gl = gl;
  }

  render(gl: WebGLRenderingContext, arg: unknown) {
    if (this.map && this.map.getZoom() < this.minZoom) return;
    const comp = this.active === null ? undefined : this.comps.get(this.active);
    (comp as { render(gl: WebGLRenderingContext, arg: unknown): void } | undefined)?.render(gl, arg);
  }

  /** Hand the component its GL context (which starts its build) and keep it under `key`. */
  async add(key: string, comp: Comp): Promise<void> {
    if (!this.map || !this.gl) throw new Error(`Layer ${this.id} is not on the map`);
    await (comp as unknown as { onAdd(map: MapLibreMap, gl: WebGLRenderingContext): Promise<void> }).onAdd(this.map, this.gl);
    this.comps.set(key, comp);
  }

  show(key: string | null) {
    this.active = key;
    this.map?.triggerRepaint();
  }

  drop(key: string) {
    this.comps.delete(key);
    if (this.active === key) this.active = null;
  }
}

interface Prebuilt {
  layers: KeyedLayer[];
  /** Keys in the order they were built or last shown, oldest first. */
  keys: Set<string>;
  pending: Map<string, Promise<void>>;
}

/** Contours and wind barbs become GPU geometry, so their data can be dropped once a layer is built. */
export function canPrebuild(def: FieldDef): boolean {
  return def.style.type === 'contour' || def.style.type === 'barbs';
}

export class WeatherLayers {
  private readonly slots = new Map<string, Slot>();
  private readonly grids = new Map<string, AnyGrid>();
  private readonly prebuilt = new Map<string, Prebuilt>();

  constructor(private readonly map: MapLibreMap) {}

  /** Draw or update an HRRR field; pass null to remove it. */
  async setField(def: FieldDef, data: FieldData | null): Promise<void> {
    if (!data) return this.remove(def.id);
    const grid = this.hrrrGrid(data.grid);
    const key = `${def.style.type}|${gridKey(data.grid)}`;
    await this.apply(def.id, key, data, () => this.buildField(def, grid, data));
  }

  /** Draw or update the dominant precipitation type raster. */
  async setPtype(frame: PtypeFrame | null, mask: Uint8Array | null, opacity: number, id = 'ptype'): Promise<void> {
    if (!frame) return this.remove(id);
    const grid = this.projGrid(frame.level.grid);
    const key = `${projKey(frame.level.grid)}|${opacity}`;
    const payload = { frame, mask };
    await this.apply(id, key, payload, () => {
      const field = (p: typeof payload) => new RawScalarField(grid, toFloat16(dominantField(p.frame, p.mask)));
      const raster = new Raster(field(payload), { cmap: PTYPE_CMAP, opacity });
      return {
        components: [{ id: `${id}-raster`, comp: raster as Comp, anchor: ANCHOR_FILLS }],
        update: (p) => raster.updateField(field(p as typeof payload)),
      };
    });
  }

  /** Draw or update contours of evidential uncertainty. */
  async setUncertainty(frame: PtypeFrame | null, mask: Uint8Array | null): Promise<void> {
    if (!frame) return this.remove('uncertainty');
    const grid = this.projGrid(frame.level.grid);
    const payload = { frame, mask };
    await this.apply('uncertainty', projKey(frame.level.grid), payload, () => {
      const field = (p: typeof payload) => {
        const values = p.mask ? p.frame.u.map((v, k) => (p.mask![k] ? v : 0)) : p.frame.u;
        return new RawScalarField(grid, values);
      };
      const contour = new Contour(field(payload), {
        color: UNCERTAINTY_COLOR,
        levels: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
        line_width: (l) => 1 + 2 * l,
      });
      const labels = new ContourLabels(contour, labelOpts((l) => l.toFixed(1), UNCERTAINTY_COLOR));
      return {
        components: [
          { id: 'uncertainty-lines', comp: contour as Comp, anchor: ANCHOR_LINES },
          { id: 'uncertainty-labels', comp: labels as Comp, anchor: ANCHOR_LINES },
        ],
        update: async (p) => {
          await contour.updateField(field(p as typeof payload));
          await labels.updateField();
        },
      };
    });
  }

  /** True when the layer for this field and key (run and forecast hour) has been built, or is being built. */
  hasPrebuilt(id: string, key: string): boolean {
    const p = this.prebuilt.get(id);
    return !!p && (p.keys.has(key) || p.pending.has(key));
  }

  /**
   * Build the layer for one forecast hour of a contour or barb field without
   * showing it. Afterwards the field's values are no longer needed: contour
   * lines and their labels live on the graphics card, so the caller can let
   * the decoded GRIB data go. Concurrent calls for the same key share one build.
   */
  prebuildField(def: FieldDef, key: string, data: FieldData): Promise<void> {
    let p = this.prebuilt.get(def.id);
    if (!p) {
      const st = def.style;
      const names = st.type === 'barbs' ? ['barbs'] : st.type === 'contour' && st.labels ? ['lines', 'labels'] : ['lines'];
      const layers = names.map((n) => new KeyedLayer(`${def.id}-${n}`));
      // A second set of layers holds the in-between lines, which only draw once the map is zoomed in.
      if (st.type === 'contour' && st.coarseInterval) layers.push(...names.map((n) => new KeyedLayer(`${def.id}-fine-${n}`, st.fineMinZoom ?? 0)));
      p = { layers, keys: new Set(), pending: new Map() };
      for (const layer of p.layers) this.map.addLayer(layer as never, ANCHOR_LINES);
      this.prebuilt.set(def.id, p);
    }
    const entry = p;
    if (entry.keys.has(key)) return Promise.resolve();
    const running = entry.pending.get(key);
    if (running) return running;
    const job = this.buildPrebuilt(def, entry, key, data).finally(() => entry.pending.delete(key));
    entry.pending.set(key, job);
    return job;
  }

  private async buildPrebuilt(def: FieldDef, entry: Prebuilt, key: string, data: FieldData): Promise<void> {
    const grid = this.hrrrGrid(data.grid);
    const style = def.style;
    if (style.type === 'barbs') {
      if (data.kind !== 'vector') throw new Error(`${def.id}: expected a vector field`);
      // The registry has already thinned the winds, so the barbs hold only a small copy.
      const barbs = new Barbs(new RawVectorField(grid, toFloat16(data.u), toFloat16(data.v), { relative_to: 'grid' }), { color: style.color, thin_fac: style.thinFac, line_width: 1.5 });
      await entry.layers[0].add(key, barbs as Comp);
    } else if (style.type === 'contour') {
      if (data.kind !== 'scalar') throw new Error(`${def.id}: expected a scalar field`);
      const field = new RawScalarField(grid, data.values);
      const nLayers = style.labels ? 2 : 1;
      // One set of lines (and labels) per group of levels: all of them, or the coarse ones and the in-between ones.
      const build = async (levels: { levels: number[] } | { interval: number }, lines: KeyedLayer, labelLayer: KeyedLayer | undefined) => {
        const contour = new Contour(field, {
          ...(style.cmap ? { cmap: style.cmap } : { color: style.color ?? '#000000' }),
          ...levels,
          line_width: style.lineWidth ?? 1.5,
          line_style: style.lineStyle ?? '-',
        });
        // autumnplot-gl keeps these private; they are read here only to learn when the upload has finished.
        const internals = contour as unknown as { contours: unknown; field: unknown };
        await lines.add(key, contour as Comp);
        await until(() => internals.contours !== null);
        if (labelLayer) {
          const labels = new ContourLabels(contour, labelOpts(style.labelFormat, style.color ?? '#111111'));
          await labelLayer.add(key, labels as Comp);
          // Labels trace the contours once more from the values, so the values must outlive this step.
          await until(() => (labels as unknown as { text_collection: unknown }).text_collection !== null);
        }
        // Lines and labels are now GPU buffers. Dropping the component's reference to the values lets the
        // ~7.6 MB array be collected. Nothing reads it again: we never call updateField on a prebuilt component.
        internals.field = null;
      };
      if (style.coarseInterval) {
        const split = splitContourLevels(data.values, style.interval ?? 1, style.coarseInterval);
        const jobs: Promise<void>[] = [];
        if (split.coarse.length > 0) jobs.push(build({ levels: split.coarse }, entry.layers[0], style.labels ? entry.layers[1] : undefined));
        if (split.fine.length > 0) jobs.push(build({ levels: split.fine }, entry.layers[nLayers], style.labels ? entry.layers[nLayers + 1] : undefined));
        await Promise.all(jobs);
      } else {
        await build(style.levels ? { levels: style.levels } : { interval: style.interval ?? 1 }, entry.layers[0], style.labels ? entry.layers[1] : undefined);
      }
    } else {
      throw new Error(`${def.id}: only contour and barb layers can be prebuilt`);
    }
    entry.keys.add(key);
    while (entry.keys.size > MAX_PREBUILT_HOURS) {
      const oldest = entry.keys.values().next().value!;
      entry.keys.delete(oldest);
      for (const layer of entry.layers) layer.drop(oldest);
    }
  }

  /** Show a prebuilt hour of a field. False if it has not been built. */
  showPrebuilt(id: string, key: string): boolean {
    const p = this.prebuilt.get(id);
    if (!p || !p.keys.has(key)) return false;
    // Mark as most recently used, so the hours around the one on screen are the last to be dropped.
    p.keys.delete(key);
    p.keys.add(key);
    for (const layer of p.layers) layer.show(key);
    return true;
  }

  remove(id: string): void {
    const pre = this.prebuilt.get(id);
    if (pre) {
      for (const layer of pre.layers) if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
      this.prebuilt.delete(id);
    }
    const slot = this.slots.get(id);
    if (!slot) return;
    for (const layerId of slot.layerIds) if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    this.slots.delete(id);
  }

  has(id: string): boolean {
    return this.slots.has(id);
  }

  private async apply(
    id: string,
    key: string,
    data: unknown,
    build: () => { components: { id: string; comp: Comp; anchor: string }[]; update(data: unknown): Promise<void> },
  ): Promise<void> {
    const existing = this.slots.get(id);
    if (existing && existing.key === key) {
      await existing.update(data);
      this.map.triggerRepaint();
      return;
    }
    this.remove(id);
    const built = build();
    for (const c of built.components) {
      // PlotLayer implements MapLibre's custom layer interface.
      this.map.addLayer(new PlotLayer(c.id, c.comp) as never, c.anchor);
    }
    this.slots.set(id, { key, layerIds: built.components.map((c) => c.id), update: built.update });
  }

  private buildField(def: FieldDef, grid: AnyGrid, first: FieldData) {
    const style = def.style;
    const scalar = (d: FieldData) => {
      if (d.kind !== 'scalar') throw new Error(`${def.id}: expected a scalar field`);
      return new RawScalarField(grid, d.values);
    };
    if (style.type === 'contour') {
      const contour = new Contour(scalar(first), {
        ...(style.cmap ? { cmap: style.cmap } : { color: style.color ?? '#000000' }),
        ...(style.levels ? { levels: style.levels } : { interval: style.interval ?? 1 }),
        line_width: style.lineWidth ?? 1.5,
        line_style: style.lineStyle ?? '-',
      });
      const components = [{ id: `${def.id}-lines`, comp: contour as Comp, anchor: ANCHOR_LINES }];
      let labels: ContourLabels<Float32Array, AnyGrid, MapLibreMap> | null = null;
      if (style.labels) {
        labels = new ContourLabels(contour, labelOpts(style.labelFormat, style.color ?? '#111111'));
        components.push({ id: `${def.id}-labels`, comp: labels as Comp, anchor: ANCHOR_LINES });
      }
      return {
        components,
        update: async (d: unknown) => {
          await contour.updateField(scalar(d as FieldData));
          if (labels) await labels.updateField();
        },
      };
    }
    if (style.type === 'barbs') {
      const vector = (d: FieldData) => {
        if (d.kind !== 'vector') throw new Error(`${def.id}: expected a vector field`);
        return new RawVectorField(grid, toFloat16(d.u), toFloat16(d.v), { relative_to: 'grid' });
      };
      const barbs = new Barbs(vector(first), { color: style.color, thin_fac: style.thinFac, line_width: 1.5 });
      return {
        components: [{ id: `${def.id}-barbs`, comp: barbs as Comp, anchor: ANCHOR_LINES }],
        update: (d: unknown) => barbs.updateField(vector(d as FieldData)),
      };
    }
    const Fill = style.type === 'raster' ? Raster : ContourFill;
    // Drawn from a texture, so 16-bit (see float16.ts); `scalar` above keeps 32 bits for contouring.
    const texture = (d: FieldData) => {
      if (d.kind !== 'scalar') throw new Error(`${def.id}: expected a scalar field`);
      return new RawScalarField(grid, toFloat16(d.values));
    };
    const fill = new Fill(texture(first), { cmap: style.cmap, opacity: style.opacity });
    return {
      components: [{ id: `${def.id}-fill`, comp: fill as Comp, anchor: ANCHOR_FILLS }],
      update: (d: unknown) => fill.updateField(texture(d as FieldData)),
    };
  }

  private hrrrGrid(g: HrrrGridInfo): AnyGrid {
    const key = gridKey(g);
    let grid = this.grids.get(key);
    if (!grid) {
      grid = LambertGrid.fromLLCornerLonLat(g.ni, g.nj, g.lon0, g.lat0, g.latStd, g.llLon, g.llLat, g.dx, g.dy, HRRR_RADIUS, HRRR_RADIUS);
      this.grids.set(key, grid);
    }
    return grid;
  }

  private projGrid(g: GridDef): AnyGrid {
    const key = projKey(g);
    let grid = this.grids.get(key);
    if (!grid) {
      grid = new LambertGrid(
        g.ni, g.nj, g.lon0, g.lat0, g.latStd,
        g.llX, g.llY, g.llX + (g.ni - 1) * g.dx, g.llY + (g.nj - 1) * g.dy,
        g.radius, g.radius,
      );
      this.grids.set(key, grid);
    }
    return grid;
  }
}

function labelOpts(format: ((level: number) => string) | undefined, color: string) {
  return {
    font_face: LABEL_FONT,
    font_size: 12,
    text_color: color,
    halo: true,
    halo_color: '#ffffff',
    // autumnplot-gl passes the level as a string key.
    ...(format ? { label_formatter: (level: number | string) => format(Number(level)) } : { n_decimal_places: 0 }),
  };
}

const gridKey = (g: HrrrGridInfo) => `hrrr|${g.ni}x${g.nj}|${g.dx}|${g.llLon.toFixed(4)},${g.llLat.toFixed(4)}`;
const projKey = (g: GridDef) => `proj|${g.ni}x${g.nj}|${g.dx}|${g.llX},${g.llY}`;
