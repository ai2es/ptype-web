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
import type { FieldData, FieldDef } from '../fields/registry';
import type { GridDef } from '../geo/lambert';
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

export class WeatherLayers {
  private readonly slots = new Map<string, Slot>();
  private readonly grids = new Map<string, AnyGrid>();

  constructor(private readonly map: MapLibreMap) {}

  /** Draw or update an HRRR field; pass null to remove it. */
  async setField(def: FieldDef, data: FieldData | null): Promise<void> {
    if (!data) return this.remove(def.id);
    const grid = this.hrrrGrid(data.grid);
    const key = `${def.style.type}|${gridKey(data.grid)}`;
    await this.apply(def.id, key, data, () => this.buildField(def, grid, data));
  }

  /** Draw or update the dominant precipitation type raster. */
  async setPtype(frame: PtypeFrame | null, mask: Uint8Array | null, opacity: number): Promise<void> {
    if (!frame) return this.remove('ptype');
    const grid = this.projGrid(frame.level.grid);
    const key = `${projKey(frame.level.grid)}|${opacity}`;
    const payload = { frame, mask };
    await this.apply('ptype', key, payload, () => {
      const field = (p: typeof payload) => new RawScalarField(grid, dominantField(p.frame, p.mask));
      const raster = new Raster(field(payload), { cmap: PTYPE_CMAP, opacity });
      return {
        components: [{ id: 'ptype-raster', comp: raster as Comp, anchor: ANCHOR_FILLS }],
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

  remove(id: string): void {
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
        return new RawVectorField(grid, d.u, d.v, { relative_to: 'grid' });
      };
      const barbs = new Barbs(vector(first), { color: style.color, thin_fac: style.thinFac, line_width: 1.5 });
      return {
        components: [{ id: `${def.id}-barbs`, comp: barbs as Comp, anchor: ANCHOR_LINES }],
        update: (d: unknown) => barbs.updateField(vector(d as FieldData)),
      };
    }
    const Fill = style.type === 'raster' ? Raster : ContourFill;
    const fill = new Fill(scalar(first), { cmap: style.cmap, opacity: style.opacity });
    return {
      components: [{ id: `${def.id}-fill`, comp: fill as Comp, anchor: ANCHOR_FILLS }],
      update: (d: unknown) => fill.updateField(scalar(d as FieldData)),
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
