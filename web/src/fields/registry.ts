/**
 * HRRR overlay fields. To add one, append an entry: say which GRIB messages
 * it needs (wgrib2 inventory strings, see any .idx file on the NOAA bucket),
 * how to turn them into the plotted values, and how to draw it.
 */
import { ColorMap, colormaps } from '../vendor/apgl';
import type { HrrrGridInfo, HrrrMessage } from '../data/hrrr';
import { PTYPE_STYLES } from '../config/ptypeStyle';
import { combine, mapValues, smooth, thin, wetBulbStull } from './gridops';

export type FieldData =
  | { kind: 'scalar'; grid: HrrrGridInfo; values: Float32Array }
  | { kind: 'vector'; grid: HrrrGridInfo; u: Float32Array; v: Float32Array };

export type LineStyle = '-' | '--' | ':' | '-.';

export type FieldStyle =
  | {
      type: 'contour';
      color?: string;
      cmap?: ColorMap;
      interval?: number;
      levels?: number[];
      lineWidth?: number | ((level: number) => number);
      lineStyle?: LineStyle | ((level: number) => LineStyle);
      labels?: boolean;
      labelFormat?: (level: number) => string;
    }
  | { type: 'fill' | 'raster'; cmap: ColorMap; opacity: number; colorbar?: { label: string; ticks?: number[] } }
  | { type: 'barbs'; color: string; thinFac: number };

export interface FieldDef {
  id: string;
  label: string;
  group: 'Surface' | 'Upper air' | 'HRRR precipitation';
  /** Short description of the drawing, shown in the layer menu. */
  note: string;
  /** Colour swatch for the layer menu. */
  swatch: string;
  load(fetch: (search: string) => Promise<HrrrMessage>): Promise<FieldData>;
  style: FieldStyle;
}

const K = 273.15;
/** Contoured fields are smoothed and thinned to every 3rd point (9 km) to keep contours clean and fast. */
const CONTOUR_THIN = 3;

function contourField(msg: HrrrMessage, values: Float32Array, radius = 4): FieldData {
  const sm = smooth(values, msg.grid.ni, msg.grid.nj, radius);
  const t = thin(sm, msg.grid, CONTOUR_THIN);
  return { kind: 'scalar', grid: t.grid, values: t.data };
}

const zeroBold = (level: number) => (level === 0 ? 2.5 : 1);
const negDashed = (level: number): LineStyle => (level < 0 ? '--' : '-');

function celsiusContour(id: string, label: string, group: FieldDef['group'], search: string, color: string): FieldDef {
  return {
    id,
    label,
    group,
    note: 'every 2 °C, 0 °C bold, below freezing dashed',
    swatch: color,
    load: async (fetch) => {
      const msg = await fetch(search);
      return contourField(msg, mapValues(msg.data, (v) => v - K));
    },
    style: { type: 'contour', color, interval: 2, lineWidth: zeroBold, lineStyle: negDashed, labels: true },
  };
}

const thicknessCmap = new ColorMap([4000, 5410, 7000], ['#1f5fbf', '#c62828']);

const hrrrPtypeCmap = new ColorMap(
  [0.5, 1.5, 2.5, 3.5, 4.5],
  PTYPE_STYLES.map((s) => s.ramp[8]),
);

export const FIELDS: FieldDef[] = [
  celsiusContour('t2m', '2 m temperature', 'Surface', ':TMP:2 m above ground:', '#c62828'),
  celsiusContour('td2m', '2 m dewpoint', 'Surface', ':DPT:2 m above ground:', '#2e7d32'),
  {
    id: 'wb2m',
    label: '2 m wet-bulb temperature',
    group: 'Surface',
    note: 'every 2 °C, 0 °C bold, below freezing dashed',
    swatch: '#0277bd',
    load: async (fetch) => {
      const [t, td] = await Promise.all([fetch(':TMP:2 m above ground:'), fetch(':DPT:2 m above ground:')]);
      return contourField(t, combine(t.data, td.data, (a, b) => wetBulbStull(a - K, b - K)));
    },
    style: { type: 'contour', color: '#0277bd', interval: 2, lineWidth: zeroBold, lineStyle: negDashed, labels: true },
  },
  {
    id: 'mslp',
    label: 'Mean sea level pressure',
    group: 'Surface',
    note: 'every 2 hPa',
    swatch: '#222222',
    load: async (fetch) => {
      const msg = await fetch(':MSLMA:mean sea level:');
      return contourField(msg, mapValues(msg.data, (v) => v / 100), 4);
    },
    style: { type: 'contour', color: '#222222', interval: 2, lineWidth: (l) => (l % 8 === 0 ? 2.5 : 1.25), labels: true },
  },
  {
    id: 'wind10m',
    label: '10 m wind barbs',
    group: 'Surface',
    note: 'knots',
    swatch: '#37474f',
    load: async (fetch) => {
      const [u, v] = await Promise.all([fetch(':UGRD:10 m above ground:'), fetch(':VGRD:10 m above ground:')]);
      const kt = (x: number) => x * 1.94384;
      return { kind: 'vector', grid: u.grid, u: mapValues(u.data, kt), v: mapValues(v.data, kt) };
    },
    style: { type: 'barbs', color: '#263238', thinFac: 256 },
  },
  {
    id: 'z700',
    label: '700 hPa height',
    group: 'Upper air',
    note: 'every 30 m',
    swatch: '#4527a0',
    load: async (fetch) => {
      const msg = await fetch(':HGT:700 mb:');
      return contourField(msg, msg.data, 4);
    },
    style: { type: 'contour', color: '#4527a0', interval: 30, lineWidth: 2, labels: true },
  },
  celsiusContour('t850', '850 hPa temperature', 'Upper air', ':TMP:850 mb:', '#ef6c00'),
  {
    id: 'thk',
    label: '1000–500 hPa thickness',
    group: 'Upper air',
    note: 'every 60 m; blue at or below 5400 m, red above',
    swatch: '#1f5fbf',
    load: async (fetch) => {
      const [z500, z1000] = await Promise.all([fetch(':HGT:500 mb:'), fetch(':HGT:1000 mb:')]);
      return contourField(z500, combine(z500.data, z1000.data, (a, b) => a - b), 5);
    },
    style: {
      type: 'contour',
      cmap: thicknessCmap,
      interval: 60,
      lineWidth: (l) => (l === 5400 ? 3 : 1.5),
      lineStyle: '--',
      labels: true,
    },
  },
  {
    id: 'refc',
    label: 'Composite reflectivity',
    group: 'HRRR precipitation',
    note: 'dBZ',
    swatch: '#43a047',
    load: async (fetch) => {
      const msg = await fetch(':REFC:entire atmosphere:');
      return { kind: 'scalar', grid: msg.grid, values: msg.data };
    },
    style: { type: 'raster', cmap: colormaps.nws_storm_clear_refl, opacity: 0.7, colorbar: { label: 'Composite reflectivity (dBZ)', ticks: [-20, 0, 20, 40, 60] } },
  },
  {
    id: 'hrrr_ptype',
    label: 'HRRR precipitation type',
    group: 'HRRR precipitation',
    note: "the HRRR's own categorical type, for comparison",
    swatch: PTYPE_STYLES[3].ramp[8],
    load: async (fetch) => {
      const [rain, snow, icep, frzr] = await Promise.all(
        [':CRAIN:surface:', ':CSNOW:surface:', ':CICEP:surface:', ':CFRZR:surface:'].map(fetch),
      );
      const values = new Float32Array(rain.data.length);
      for (let k = 0; k < values.length; k++) {
        values[k] = frzr.data[k] > 0.5 ? 4 : icep.data[k] > 0.5 ? 3 : snow.data[k] > 0.5 ? 2 : rain.data[k] > 0.5 ? 1 : 0;
      }
      return { kind: 'scalar', grid: rain.grid, values };
    },
    style: { type: 'raster', cmap: hrrrPtypeCmap, opacity: 0.75 },
  },
];

export const FIELD_BY_ID = new Map(FIELDS.map((f) => [f.id, f]));
