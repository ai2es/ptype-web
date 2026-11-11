/** Reads precipitation-type probabilities from a topozarr (multiscale Zarr v3) store. */
import * as zarr from 'zarrita';
import { parseProj4Lambert, type GridDef } from '../geo/lambert';

export const PTYPE_CLASSES = ['rain', 'snow', 'icep', 'frzr'] as const;
export type PtypeClass = (typeof PTYPE_CLASSES)[number];

export interface PtypeLevel {
  /** Group path of this level inside the store. */
  path: string;
  grid: GridDef;
  /** True when rows are stored north to south and must be flipped. */
  flipRows: boolean;
}

export interface PtypeStore {
  url: string;
  group: zarr.Group<zarr.FetchStore>;
  /** Finest level first. */
  levels: PtypeLevel[];
  forecastHours: number[];
}

/** One forecast hour of one pyramid level. All arrays are row-major from the south-west corner. */
export interface PtypeFrame {
  level: PtypeLevel;
  probs: Record<PtypeClass, Float32Array>;
  u: Float32Array;
}

interface LayoutEntry {
  asset: string;
  'spatial:transform': number[];
  'spatial:shape': number[];
}

const stores = new Map<string, Promise<PtypeStore>>();

async function open(url: string): Promise<PtypeStore> {
  const group = await zarr.open.v3(new zarr.FetchStore(url), { kind: 'group' });
  const attrs = group.attrs as Record<string, unknown>;
  const layout = (attrs.multiscales as { layout?: LayoutEntry[] } | undefined)?.layout;
  const projCode = attrs['proj:code'];
  if (!layout || typeof projCode !== 'string') {
    throw new Error('Store is missing multiscales / proj:code metadata (expected a topozarr store)');
  }
  const proj = parseProj4Lambert(projCode);
  const levels = layout.map((entry): PtypeLevel => {
    // Affine transform [a, b, c, d, e, f]: x = a*col + c, y = e*row + f at cell edges.
    const [a, , c, , e, f] = entry['spatial:transform'];
    const [nj, ni] = entry['spatial:shape'];
    const flipRows = e < 0;
    const dy = Math.abs(e);
    const llY = flipRows ? f - dy * (nj - 0.5) : f + dy / 2;
    return { path: entry.asset, flipRows, grid: { ...proj, ni, nj, dx: a, dy, llX: c + a / 2, llY } };
  });
  const fhArr = await zarr.open.v3(group.resolve(`${levels[0].path}/forecast_hour`), { kind: 'array' });
  const fh = await zarr.get(fhArr);
  return { url, group, levels, forecastHours: Array.from(fh.data as ArrayLike<number | bigint>, Number) };
}

export function openPtypeStore(url: string): Promise<PtypeStore> {
  let p = stores.get(url);
  if (!p) {
    p = open(url).catch((err) => {
      stores.delete(url);
      throw err;
    });
    stores.set(url, p);
  }
  return p;
}

function flip(data: Float32Array, ni: number, nj: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let j = 0; j < nj; j++) out.set(data.subarray(j * ni, (j + 1) * ni), (nj - 1 - j) * ni);
  return out;
}

async function readVar(store: PtypeStore, level: PtypeLevel, name: string, fhIndex: number): Promise<Float32Array> {
  const arr = await zarr.open.v3(store.group.resolve(`${level.path}/${name}`), { kind: 'array' });
  const { data } = await zarr.get(arr, [fhIndex, null, null]);
  const f32 = data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
  return level.flipRows ? flip(f32, level.grid.ni, level.grid.nj) : f32;
}

const frames = new Map<string, Promise<PtypeFrame>>();
const MAX_FRAMES = 60;

/** Read one forecast hour at one pyramid level (cached). */
export function readPtypeFrame(store: PtypeStore, levelIndex: number, fhour: number): Promise<PtypeFrame> {
  const key = `${store.url}|${levelIndex}|${fhour}`;
  const hit = frames.get(key);
  if (hit) return hit;
  const fhIndex = store.forecastHours.indexOf(fhour);
  if (fhIndex < 0) return Promise.reject(new Error(`Forecast hour ${fhour} is not in the store`));
  const level = store.levels[levelIndex];
  const p = Promise.all(
    ['ML_rain', 'ML_snow', 'ML_icep', 'ML_frzr', 'ML_u'].map((v) => readVar(store, level, v, fhIndex)),
  ).then(([rain, snow, icep, frzr, u]) => ({ level, probs: { rain, snow, icep, frzr }, u }));
  p.catch(() => frames.delete(key));
  frames.set(key, p);
  if (frames.size > MAX_FRAMES) frames.delete(frames.keys().next().value!);
  return p;
}

/**
 * Pick the coarsest level that still gives about one grid cell per
 * `pixelsPerCell` screen pixels at the given map zoom and latitude.
 */
export function chooseLevel(store: PtypeStore, zoom: number, lat: number, pixelsPerCell = 2): number {
  const metresPerPixel = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  let best = 0;
  store.levels.forEach((lvl, k) => {
    if (lvl.grid.dx <= metresPerPixel * pixelsPerCell) best = k;
  });
  return best;
}
