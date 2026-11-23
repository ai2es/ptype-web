/**
 * HRRR overlay fields. To add one, append an entry: say which GRIB messages
 * it needs (wgrib2 inventory strings, see any .idx file on the NOAA bucket),
 * how to turn them into the plotted values, and how to draw it.
 */
import { ColorMap, colormaps } from '../vendor/apgl';
import type { HrrrGridInfo, HrrrMessage } from '../data/hrrr';
import { PTYPE_STYLES } from '../config/ptypeStyle';
import { INCHES_PER_METRE, combine, hourlySnowfallInches, mapValues, smooth, thin, wetBulbStull } from './gridops';

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
      /**
       * Draw only every `coarseInterval` when the map is zoomed out, and the remaining `interval` lines from
       * zoom `fineMinZoom` inwards. Must be a multiple of `interval`.
       */
      coarseInterval?: number;
      fineMinZoom?: number;
      levels?: number[];
      lineWidth?: number | ((level: number) => number);
      lineStyle?: LineStyle | ((level: number) => LineStyle);
      labels?: boolean;
      labelFormat?: (level: number) => string;
    }
  | { type: 'fill' | 'raster'; cmap: ColorMap; opacity: number; colorbar?: { label: string; ticks?: number[] } }
  | { type: 'barbs'; color: string; thinFac: number };

/**
 * Fetches one GRIB message of the run being drawn. `hoursBack` reads it from an earlier forecast hour of the
 * same run instead (1 = the hour before): the HRRR gives snowfall only as a total since the start of the run,
 * so an hourly amount is the difference between two files.
 */
export type FieldFetch = (search: string, hoursBack?: number) => Promise<HrrrMessage>;

export interface FieldDef {
  id: string;
  label: string;
  group: 'Surface' | 'Upper air' | 'HRRR precipitation';
  /** Short description of the drawing, shown in the layer menu. */
  note: string;
  /** Colour swatch for the layer menu. */
  swatch: string;
  /** `fhour` is the forecast hour being drawn, for fields that depend on it (see `FieldFetch`). */
  load(fetch: FieldFetch, fhour: number): Promise<FieldData>;
  style: FieldStyle;
}

const K = 273.15;
/** Contoured fields are smoothed and thinned to every 3rd point (9 km) to keep contours clean and fast. */
const CONTOUR_THIN = 3;

/**
 * Box-blur radius, in 3 km grid points, for temperature-like fields. Near-surface temperature follows the
 * terrain closely, so it needs more smoothing than pressure or height to give readable contours.
 */
const TEMPERATURE_SMOOTH = 6;

function contourField(msg: HrrrMessage, values: Float32Array, radius = 4): FieldData {
  const sm = smooth(values, msg.grid.ni, msg.grid.nj, radius);
  const t = thin(sm, msg.grid, CONTOUR_THIN);
  return { kind: 'scalar', grid: t.grid, values: t.data };
}

/**
 * Temperature contours every 4 °C at the national view and every 2 °C once zoomed in to a region. The map opens
 * at zoom 4.4; 5.5 is roughly where a few states fill the window.
 */
const ZOOMED_OUT_4C = { coarseInterval: 4, fineMinZoom: 5.5 };

const zeroBold = (level: number) => (level === 0 ? 2.5 : 1);
const negDashed = (level: number): LineStyle => (level < 0 ? '--' : '-');

function celsiusContour(id: string, label: string, group: FieldDef['group'], search: string, color: string): FieldDef {
  return {
    id,
    label,
    group,
    note: 'every 4 °C (2 °C when zoomed in), 0 °C bold, below freezing dashed',
    swatch: color,
    load: async (fetch) => {
      const msg = await fetch(search);
      return contourField(msg, mapValues(msg.data, (v) => v - K), TEMPERATURE_SMOOTH);
    },
    style: { type: 'contour', color, interval: 2, ...ZOOMED_OUT_4C, lineWidth: zeroBold, lineStyle: negDashed, labels: true },
  };
}

const thicknessCmap = new ColorMap([4000, 5410, 7000], ['#1f5fbf', '#c62828']);

/**
 * Snow on the ground, inches. Bins widen with depth, as on NWS snow maps; anything under a tenth of an inch is
 * not drawn. Pale yellow-green to navy (ColorBrewer YlGnBu), so it reads apart from the snow blues of the
 * precipitation-type layer.
 */
const snowDepthCmap = new ColorMap(
  [0.1, 1, 2, 4, 6, 8, 12, 18, 24, 36, 48],
  ['#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58', '#4a1486', '#7a0177'],
  { overflow_color: '#ae017e' },
);

/** Snowfall in the past hour, inches. An inch an hour is heavy snow; pinks to wine (ColorBrewer PuRd). */
const snowfallRateCmap = new ColorMap(
  [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3],
  ['#e7e1ef', '#d4b9da', '#c994c7', '#df65b0', '#e7298a', '#ce1256', '#980043', '#67001f'],
  { overflow_color: '#3d0012' },
);

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
    note: 'every 4 °C (2 °C when zoomed in), 0 °C bold, below freezing dashed',
    swatch: '#0277bd',
    load: async (fetch) => {
      const [t, td] = await Promise.all([fetch(':TMP:2 m above ground:'), fetch(':DPT:2 m above ground:')]);
      return contourField(t, combine(t.data, td.data, (a, b) => wetBulbStull(a - K, b - K)), TEMPERATURE_SMOOTH);
    },
    style: { type: 'contour', color: '#0277bd', interval: 2, ...ZOOMED_OUT_4C, lineWidth: zeroBold, lineStyle: negDashed, labels: true },
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
    style: { type: 'raster', cmap: colormaps.nws_storm_clear_refl.withOpacity((lower) => (lower < 0 ? 0 : 1)), opacity: 0.7, colorbar: { label: 'Composite reflectivity (dBZ)', ticks: [0, 20, 40, 60] } },
  },
  {
    id: 'snod',
    label: 'Snow depth',
    group: 'HRRR precipitation',
    note: 'inches on the ground',
    swatch: '#1d91c0',
    load: async (fetch) => {
      const msg = await fetch(':SNOD:surface:');
      return { kind: 'scalar', grid: msg.grid, values: mapValues(msg.data, (v) => v * INCHES_PER_METRE) };
    },
    style: { type: 'raster', cmap: snowDepthCmap, opacity: 0.75, colorbar: { label: 'Snow depth (in)', ticks: [0.1, 1, 2, 4, 6, 8, 12, 18, 24, 36, 48] } },
  },
  {
    id: 'snowrate',
    label: 'Snowfall rate',
    group: 'HRRR precipitation',
    note: 'inches of snow in the past hour; nothing at F00',
    swatch: '#e7298a',
    load: async (fetch, fhour) => {
      // ASNOW is the snowfall since the start of the run, so the hour's amount needs the file before as well.
      const [total, previous] = await Promise.all([fetch(':ASNOW:surface:'), fhour > 0 ? fetch(':ASNOW:surface:', 1) : null]);
      return { kind: 'scalar', grid: total.grid, values: hourlySnowfallInches(total.data, previous?.data ?? null) };
    },
    style: { type: 'raster', cmap: snowfallRateCmap, opacity: 0.8, colorbar: { label: 'Snowfall in the past hour (in)', ticks: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3] } },
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
