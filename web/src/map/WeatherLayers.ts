/**
 * Owns every autumnplot-gl layer on the map. React code hands it data; it
 * creates the plot components the first time and afterwards only swaps the
 * field data, which is what keeps time stepping fast.
 */
import { isKept, type KeepFrame } from '../time/trend';
import {
  Barbs, Contour, ContourFill, ContourLabels, LambertGrid, PlotLayer, Raster, RawScalarField, RawVectorField,
  type PlotComponent,
} from '../vendor/apgl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { UNCERTAINTY_COLOR } from '../config/ptypeStyle';
import type { HrrrGridInfo } from '../data/hrrr';
import { uncertainty, type PtypeFrame } from '../data/ptype';
import { smooth, splitContourLevels, thin } from '../fields/gridops';
import type { FieldData, FieldDef } from '../fields/registry';
import { Lambert, type GridDef } from '../geo/lambert';
import { isLowMemoryDevice } from '../config/device';
import { registerMemoryStats } from '../debug/memory';
import { toFloat16 } from './float16';
import { ANCHOR_FILLS, ANCHOR_LINES, LABEL_FONT } from './style';
import { PTYPE_CMAP, dominantField } from './ptypeField';

type Comp = PlotComponent<MapLibreMap>;
type AnyGrid = LambertGrid;

interface Slot {
  key: string;
  layerIds: string[];
  comps: Comp[];
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
 * Delete the graphics-card buffers and textures a plot component owns.
 *
 * autumnplot-gl never deletes them itself: it relies on the browser freeing them
 * when the JavaScript handles are garbage collected, and the collector cannot see
 * how much graphics memory a handle stands for, so it is in no hurry. Measured
 * with the `?memdebug` probe: a 48-hour run of two contour fields held 477 MB of
 * buffers and none of it had been freed after switching run twice.
 *
 * Only the parts a component owns outright are walked for handles: contour lines,
 * label text, fill and wind textures. Fills and barbs also hold vertex buffers that
 * belong to the grid and are shared with every other component on it; those are
 * reached through `gl_elems` and are deliberately left alone.
 */
function disposeGl(comp: unknown, gl: WebGLRenderingContext): void {
  const c = comp as Record<string, unknown> & { gl_elems?: { barb_billboards?: Record<string, unknown> & { gl_elems?: Record<string, unknown> } } | null };
  const billboards = c.gl_elems?.barb_billboards;
  // Not the barbs' glyph texture: one copy is shared by every hour (see `shareBarbResources`).
  const roots = [c.contours, c.text_collection, c.fill_texture, c.mask_texture, billboards?.wind_textures, billboards?.gl_elems?.geom_vertices];
  const maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
  const seen = new Set<unknown>();
  const stack = roots.map((value) => ({ value, depth: 0 }));
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (value === null || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof WebGLBuffer) {
      // Deleting a buffer detaches it from any vertex attribute it feeds but leaves the attribute enabled,
      // and the next draw call then fails ("no buffer is bound to enabled attribute"). Disable those first.
      for (let i = 0; i < maxAttribs; i++) {
        if (gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING) === value) gl.disableVertexAttribArray(i);
      }
      gl.deleteBuffer(value);
    }
    else if (value instanceof WebGLTexture) gl.deleteTexture(value);
    // Typed arrays have no handles inside; the context and DOM nodes are not the component's.
    else if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value === gl || value instanceof Node) continue;
    else if (depth < 6) for (const child of Array.isArray(value) ? value : Object.values(value)) stack.push({ value: child, depth: depth + 1 });
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

  /**
   * `minZoom`, `maxZoom`: draw only while the map zoom is in [minZoom, maxZoom). Used for the in-between
   * contour lines, which appear once zoomed in, and for the two densities of wind barbs.
   */
  constructor(readonly id: string, private readonly minZoom = 0, private readonly maxZoom = Infinity) {}

  /** The graphics context, once the layer is on the map. */
  get context(): WebGLRenderingContext | null {
    return this.gl;
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext) {
    this.map = map;
    this.gl = gl;
  }

  render(gl: WebGLRenderingContext, arg: unknown) {
    if (this.map && (this.map.getZoom() < this.minZoom || this.map.getZoom() >= this.maxZoom)) return;
    const comp = this.active === null ? undefined : this.comps.get(this.active);
    (comp as { render(gl: WebGLRenderingContext, arg: unknown): void } | undefined)?.render(gl, arg);
  }

  /** Hand the component its GL context (which starts its build) and keep it under `key`. */
  async add(key: string, comp: Comp): Promise<void> {
    if (!this.map || !this.gl) throw new Error(`Layer ${this.id} is not on the map`);
    await (comp as unknown as { onAdd(map: MapLibreMap, gl: WebGLRenderingContext): Promise<void> }).onAdd(this.map, this.gl);
    this.comps.set(key, comp);
  }

  peek(key: string): Comp | undefined {
    return this.comps.get(key);
  }

  show(key: string | null) {
    this.active = key;
    this.map?.triggerRepaint();
  }

  /** Forget one key and free its graphics memory. */
  drop(key: string) {
    const comp = this.comps.get(key);
    this.comps.delete(key);
    if (this.active === key) this.active = null;
    if (comp && this.gl) disposeGl(comp, this.gl);
  }

  /** Forget every key (the layer is being removed). */
  dropAll() {
    for (const key of [...this.comps.keys()]) this.drop(key);
  }
}

interface Prebuilt {
  layers: KeyedLayer[];
  /** Keys in the order they were built or last shown, oldest first. */
  keys: Set<string>;
  pending: Map<string, Promise<void>>;
}

/** Uncertainty is smoothed over about this distance (box blur radius), whatever the pyramid level. */
/**
 * Wind barbs are drawn from two thinned copies of the wind grid, by zoom. autumnplot-gl draws a barb at
 * every grid point it is given on every frame and hides the ones the zoom does not call for in the shader,
 * so the full 1799 x 1059 grid cost 16 ms a frame at any zoom (measured), for a few hundred visible barbs.
 * The barbs are 2^(9 - zoom) cells apart (32 cells at zoom 4), so below zoom 7 every 8th point (30,000
 * barbs) loses nothing. From zoom 7 every 2nd point is kept (477,000): the same barbs as before up to
 * zoom 9, and from there barbs 6 km apart, where the full grid gave 3 km.
 */
const BARB_TIERS = [
  { name: 'coarse', step: 8, minZoom: 0, maxZoom: 7 },
  { name: 'fine', step: 2, minZoom: 7, maxZoom: Infinity },
];

const UNCERTAINTY_SMOOTH_M = 9000;

/** Contours every 0.02, of which only every 0.1 is drawn until the map is zoomed in to a region. */
const UNCERTAINTY_DEF: FieldDef = {
  id: 'uncertainty',
  label: 'Epistemic uncertainty',
  group: 'Surface',
  note: '',
  swatch: UNCERTAINTY_COLOR,
  load: () => Promise.reject(new Error('uncertainty comes from the precipitation-type store')),
  style: {
    type: 'contour',
    color: UNCERTAINTY_COLOR,
    interval: 0.02,
    coarseInterval: 0.1,
    fineMinZoom: 5.5,
    lineWidth: (l) => 1 + 1.5 * l,
    labels: true,
    // One decimal for the 0.1 lines, two for the ones in between.
    labelFormat: (l) => l.toFixed(Math.abs(l * 10 - Math.round(l * 10)) < 1e-6 ? 1 : 2),
  },
};

/**
 * Every HRRR field is drawn from graphics memory alone once built (lines, barbs, or a 16-bit texture), so its
 * decoded values can be dropped. Kept as a function because callers ask per field.
 */
export function canPrebuild(_def: FieldDef): boolean {
  return true;
}

export class WeatherLayers {
  private readonly slots = new Map<string, Slot>();
  private readonly grids = new Map<string, AnyGrid>();
  private readonly prebuilt = new Map<string, Prebuilt>();
  private keep: KeepFrame[] | null = null;
  /** The barb glyph texture and shader program, made by the first barb layer and used by all the others. */
  private barbShared: { texture: unknown; shader_manager: unknown } | null = null;

  constructor(private readonly map: MapLibreMap) {
    registerMemoryStats('prebuiltBreakdown', () => this.breakdown());
    registerMemoryStats('prebuilt', () => {
      const out: Record<string, { hours: number; runs: number }> = {};
      for (const [id, p] of this.prebuilt) out[id] = { hours: p.keys.size, runs: new Set([...p.keys].map((k) => k.split('|')[0])).size };
      return out;
    });
  }

  /** Graphics bytes of the newest prebuilt hour of each field, split into lines and labels (memory probe only). */
  private breakdown(): Record<string, Record<string, number>> {
    const bytes = (root: unknown): number => {
      let total = 0;
      const seen = new Set<unknown>();
      const stack = [root];
      while (stack.length > 0) {
        const v = stack.pop() as Record<string, unknown> | null;
        if (v === null || typeof v !== 'object' || seen.has(v) || ArrayBuffer.isView(v) || v instanceof Node) continue;
        seen.add(v);
        if (v.buffer instanceof WebGLBuffer && typeof v.n_verts === 'number') total += (v.n_verts as number) * (v.n_coords_per_vert as number) * 4;
        // Pushed one at a time: spreading a long array into push() overflows the call stack.
        else if (seen.size < 5000) for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push(child);
      }
      return Math.round(total / 1024);
    };
    const out: Record<string, Record<string, number>> = {};
    for (const [id, p] of this.prebuilt) {
      const key = [...p.keys].pop();
      if (!key) continue;
      out[id] = {};
      for (const layer of p.layers) {
        const c = layer.peek(key) as Record<string, unknown> | undefined;
        if (c) out[id][`${layer.id.replace(`${id}-`, '')} kB`] = bytes(c.contours) + bytes(c.text_collection) + bytes((c.gl_elems as Record<string, unknown> | null)?.barb_billboards);
      }
    }
    return out;
  }

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

  /**
   * Draw contours of evidential uncertainty for one frame; pass null to remove them. `key` names the run,
   * hour and pyramid level, so an hour already built is shown again without recontouring.
   *
   * The field is smoothed first (the network's uncertainty is noisy from cell to cell), then cut to the
   * precipitation mask. Lines are every 0.1 at the national view and every 0.02 once zoomed in.
   */
  async setUncertainty(frame: PtypeFrame | null, mask: Uint8Array | null, key = ''): Promise<void> {
    if (!frame) return this.remove(UNCERTAINTY_DEF.id);
    if (this.showPrebuilt(UNCERTAINTY_DEF.id, key)) return;
    const g = frame.level.grid;
    // Back to floats for contouring; only frames that are drawn are ever expanded.
    const raw = Float32Array.from(frame.u, uncertainty);
    const values = smooth(raw, g.ni, g.nj, Math.max(1, Math.round(UNCERTAINTY_SMOOTH_M / g.dx)));
    // Outside the mask there is nothing to contour: NaN ends the lines at the edge of the precipitation.
    if (mask) for (let k = 0; k < values.length; k++) if (!mask[k]) values[k] = NaN;
    const [llLon, llLat] = new Lambert(g).inverse(g.llX, g.llY);
    const grid: HrrrGridInfo = { ni: g.ni, nj: g.nj, lon0: g.lon0, lat0: g.lat0, latStd: g.latStd, llLon, llLat, dx: g.dx, dy: g.dy };
    await this.prebuildField(UNCERTAINTY_DEF, key, { kind: 'scalar', grid, values });
    this.showPrebuilt(UNCERTAINTY_DEF.id, key);
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
      const names = st.type === 'barbs' ? [] : st.type !== 'contour' ? ['fill'] : st.labels ? ['lines', 'labels'] : ['lines'];
      const layers = names.map((n) => new KeyedLayer(`${def.id}-${n}`));
      // Barbs: one layer per density, each drawn over its own range of zoom.
      if (st.type === 'barbs') layers.push(...BARB_TIERS.map((t) => new KeyedLayer(`${def.id}-barbs-${t.name}`, t.minZoom, t.maxZoom)));
      // A second set of layers holds the in-between lines, which only draw once the map is zoomed in.
      if (st.type === 'contour' && st.coarseInterval) layers.push(...names.map((n) => new KeyedLayer(`${def.id}-fine-${n}`, st.fineMinZoom ?? 0)));
      p = { layers, keys: new Set(), pending: new Map() };
      for (const layer of p.layers) this.map.addLayer(layer as never, st.type === 'fill' || st.type === 'raster' ? ANCHOR_FILLS : ANCHOR_LINES);
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
      for (const [k, tier] of BARB_TIERS.entries()) {
        const u = thin(data.u, data.grid, tier.step);
        const v = thin(data.v, data.grid, tier.step);
        // `thinFac` is in cells of the full grid, so the spacing on screen is the same as without thinning.
        const barbs = new Barbs(new RawVectorField(this.barbGrid(u.grid), toFloat16(u.data), toFloat16(v.data), { relative_to: 'grid' }), { color: style.color, thin_fac: style.thinFac / tier.step, line_width: 1.5 });
        await entry.layers[k].add(key, barbs as Comp);
        this.shareBarbResources(barbs, entry.layers[k].context);
      }
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
      if (data.kind !== 'scalar') throw new Error(`${def.id}: expected a scalar field`);
      // A filled field is one texture, 16-bit (see float16.ts): half the size of the decoded values it replaces.
      const Fill = style.type === 'raster' ? Raster : ContourFill;
      const fill = new Fill(new RawScalarField(grid, toFloat16(data.values)), { cmap: style.cmap, opacity: style.opacity });
      const internals = fill as unknown as { fill_texture: unknown; field: unknown };
      await entry.layers[0].add(key, fill as Comp);
      await until(() => internals.fill_texture !== null);
      // Drawing reads only the texture, so the values can go.
      internals.field = null;
    }
    entry.keys.add(key);
    while (entry.keys.size > MAX_PREBUILT_HOURS) {
      const oldest = entry.keys.values().next().value!;
      entry.keys.delete(oldest);
      for (const layer of entry.layers) layer.drop(oldest);
    }
    // A build can finish after the user has moved to another run; do not let it bring the old run back.
    if (!this.keeps(key)) this.dropPrebuilt(entry, key);
  }

  private dropPrebuilt(entry: Prebuilt, key: string): void {
    entry.keys.delete(key);
    for (const layer of entry.layers) layer.drop(key);
  }

  /** Prebuilt keys start with `init|fhour`. */
  private keeps(key: string): boolean {
    if (this.keep === null) return true;
    const [init, fhour] = key.split('|');
    return isKept(this.keep, init, Number(fhour));
  }

  /**
   * Keep only the prebuilt hours that `keep` covers (the selected run, or the runs of a trend loop)
   * and free the rest, including any that are still being built. Pass null to stop filtering.
   */
  keepOnlyPrebuilt(keep: KeepFrame[] | null): void {
    this.keep = keep;
    for (const entry of this.prebuilt.values()) {
      for (const key of [...entry.keys]) if (!this.keeps(key)) this.dropPrebuilt(entry, key);
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
      for (const layer of pre.layers) {
        layer.dropAll();
        if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id);
      }
      this.prebuilt.delete(id);
    }
    const slot = this.slots.get(id);
    if (!slot) return;
    for (const layerId of slot.layerIds) if (this.map.getLayer(layerId)) this.map.removeLayer(layerId);
    const gl = this.map.painter.context.gl as WebGLRenderingContext;
    for (const comp of slot.comps) disposeGl(comp, gl);
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
    this.slots.set(id, { key, layerIds: built.components.map((c) => c.id), comps: built.components.map((c) => c.comp), update: built.update });
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

  /**
   * The grid for a set of barbs. autumnplot-gl asks the grid for a "thinned" copy every time a barb
   * layer is built and hangs the barb positions and the wind-rotation texture on that copy, so each
   * forecast hour used to compute and upload its own (measured: 2.1 s and 29 MB of graphics memory per
   * hour on the full grid). Handing back the same copy each time makes every hour share one set.
   */
  private barbGrid(g: HrrrGridInfo): AnyGrid {
    const grid = this.hrrrGrid(g) as AnyGrid & { getThinnedGrid(thinFac: number, maxZoom: number): AnyGrid; barbCopies?: Map<string, AnyGrid> };
    if (!grid.barbCopies) {
      const copies = new Map<string, AnyGrid>();
      const make = grid.getThinnedGrid.bind(grid);
      grid.barbCopies = copies;
      grid.getThinnedGrid = (thinFac, maxZoom) => {
        const key = `${thinFac}|${maxZoom}`;
        if (!copies.has(key)) copies.set(key, make(thinFac, maxZoom));
        return copies.get(key)!;
      };
    }
    return grid;
  }

  /**
   * Every barb layer draws the same sheet of barb shapes with the same shader, but autumnplot-gl gives
   * each one its own 1024 x 1024 canvas, a 4 MB texture made from it, and a shader program compiled the
   * first time it is drawn. Keep the first layer's and point the others at them.
   */
  private shareBarbResources(barbs: unknown, gl: WebGLRenderingContext | null): void {
    const b = barbs as { barb_texture: unknown; gl_elems: { barb_billboards: { billboard_image: unknown; gl_elems: { texture: { texture?: WebGLTexture }; shader_manager: unknown } | null } } | null };
    const own = b.gl_elems?.barb_billboards.gl_elems;
    if (!own) return;
    if (!this.barbShared) this.barbShared = { texture: own.texture, shader_manager: own.shader_manager };
    else {
      if (gl && own.texture.texture) gl.deleteTexture(own.texture.texture);
      own.texture = this.barbShared.texture as typeof own.texture;
      own.shader_manager = this.barbShared.shader_manager;
    }
    // The canvas was only needed for the upload.
    b.barb_texture = null;
    b.gl_elems!.barb_billboards.billboard_image = null;
  }

  private hrrrGrid(g: HrrrGridInfo): AnyGrid {
    const key = gridKey(g);
    let grid = this.grids.get(key);
    if (!grid) {
      // autumnplot-gl takes the far corner to be ni * dx from the first point and then spreads the ni points
      // over that span, which stretches the grid by one cell: 3 km at the north-east corner of the full grid,
      // but 24 km on the every-8th-point grid the barbs use. Scale the spacing so the last point lands where
      // it should, (ni - 1) * dx from the first.
      const dx = (g.dx * (g.ni - 1)) / g.ni;
      const dy = (g.dy * (g.nj - 1)) / g.nj;
      grid = LambertGrid.fromLLCornerLonLat(g.ni, g.nj, g.lon0, g.lat0, g.latStd, g.llLon, g.llLat, dx, dy, HRRR_RADIUS, HRRR_RADIUS);
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

/**
 * autumnplot-gl places labels for the map's closest zoom (10) and hides most of them further out, so nearly
 * all of the label geometry is never seen at the zooms a 9 km contour is read at. Labels were 70% of a
 * contour layer's graphics memory (4.9 of 6.2 MB an hour for sea level pressure). Half the density
 * spaces them as for zoom 9: the same labels up to there, and still about one per line across the window
 * at zoom 10 (a quarter left most lines unlabelled there).
 */
const LABEL_DENSITY = 0.5;

function labelOpts(format: ((level: number) => string) | undefined, color: string) {
  return {
    density: LABEL_DENSITY,
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
