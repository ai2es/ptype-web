/** Reads precipitation-type probabilities from a topozarr (multiscale Zarr v3) store. */
import * as zarr from 'zarrita';
import { isLowMemoryDevice } from '../config/device';
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
  /** True when the store has the HRRR precipitation mask alongside the probabilities. */
  hasMask: boolean;
  /** True when the store has the revised Bourgouin probabilities (BOURG_*). */
  hasBourgouin: boolean;
}

/**
 * Which diagnosis a frame holds: the evidential neural network, or the revised
 * Bourgouin layer-energy method (Birk et al. 2021) computed from the same
 * profiles. Bourgouin's four probabilities are independent and need not sum to 1.
 */
export type PtypeSource = 'ML' | 'BOURG';

/**
 * Frames are kept quantized: 32-bit floats made a 48-hour run of frames the largest thing in memory (467 MB
 * at the level used for the national view). A probability is stored as a byte in steps of 1/254 and the
 * uncertainty as 16 bits, 6 bytes a cell where there were 20. The map shades probability in steps of 10%
 * and the readout shows whole percent, so nothing visible changes. The top code of each type marks missing.
 */
export const PROB_SCALE = 254;
const PROB_MISSING = 255;
const U_SCALE = 65534;
const U_MISSING = 65535;

export function quantizeProbability(values: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(values.length);
  for (let k = 0; k < out.length; k++) {
    const v = values[k];
    out[k] = Number.isNaN(v) ? PROB_MISSING : Math.round(Math.min(Math.max(v, 0), 1) * PROB_SCALE);
  }
  return out;
}

export function quantizeUncertainty(values: ArrayLike<number>): Uint16Array {
  const out = new Uint16Array(values.length);
  for (let k = 0; k < out.length; k++) {
    const v = values[k];
    out[k] = Number.isNaN(v) ? U_MISSING : Math.round(Math.min(Math.max(v, 0), 1) * U_SCALE);
  }
  return out;
}

/** Probability (0 to 1) from its stored byte; NaN where missing. */
export function probability(code: number): number {
  return code === PROB_MISSING ? NaN : code / PROB_SCALE;
}

/** Uncertainty (0 to 1) from its stored value; NaN where missing. */
export function uncertainty(code: number): number {
  return code === U_MISSING ? NaN : code / U_SCALE;
}

/** One forecast hour of one pyramid level. All arrays are row-major from the south-west corner. */
export interface PtypeFrame {
  level: PtypeLevel;
  /** Probability of each class as a byte: see `PROB_SCALE` and `probability`. */
  probs: Record<PtypeClass, Uint8Array>;
  /** Evidential uncertainty as 16 bits (`uncertainty`); empty for Bourgouin frames, which have none. */
  u: Uint16Array;
  /** 1 where the HRRR has precipitation, when the store carries that field. */
  mask?: Uint8Array;
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
  // Stores written by ptype.hrrr_fast list their variables; older ones have only the probabilities.
  const variables = (attrs.hrrr_ptype as { variables?: Record<string, unknown> } | undefined)?.variables;
  return { url, group, levels, forecastHours: Array.from(fh.data as ArrayLike<number | bigint>, Number), hasMask: !!variables && 'precip_mask' in variables, hasBourgouin: !!variables && 'BOURG_rain' in variables };
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

function flip<T extends Float32Array | Uint8Array>(data: T, ni: number, nj: number): T {
  const out = new (data.constructor as new (n: number) => T)(data.length);
  for (let j = 0; j < nj; j++) out.set(data.subarray(j * ni, (j + 1) * ni), (nj - 1 - j) * ni);
  return out;
}

async function readVar(store: PtypeStore, level: PtypeLevel, name: string, fhIndex: number): Promise<Float32Array> {
  const arr = await zarr.open.v3(store.group.resolve(`${level.path}/${name}`), { kind: 'array' });
  const { data } = await zarr.get(arr, [fhIndex, null, null]);
  const f32 = data instanceof Float32Array ? data : Float32Array.from(data as ArrayLike<number>);
  return level.flipRows ? flip(f32, level.grid.ni, level.grid.nj) : f32;
}

async function readMask(store: PtypeStore, level: PtypeLevel, fhIndex: number): Promise<Uint8Array> {
  const arr = await zarr.open.v3(store.group.resolve(`${level.path}/precip_mask`), { kind: 'array' });
  const { data } = await zarr.get(arr, [fhIndex, null, null]);
  const u8 = data instanceof Uint8Array ? data : Uint8Array.from(data as ArrayLike<number>);
  return level.flipRows ? flip(u8, level.grid.ni, level.grid.nj) : u8;
}

const frames = new Map<string, Promise<PtypeFrame>>();
const frameSizes = new Map<string, number>();
/**
 * Frames are cached by size, not count: one hour is about 0.7 MB at the coarsest
 * pyramid level and 13 MB at the native 3 km grid.
 */
const MAX_FRAME_BYTES = (isLowMemoryDevice() ? 96 : 512) * 1024 * 1024;

function frameSize(level: PtypeLevel, withMask: boolean): number {
  return level.grid.ni * level.grid.nj * (4 + 2 + (withMask ? 1 : 0));
}

const frameKey = (store: PtypeStore, levelIndex: number, fhour: number, source: PtypeSource) =>
  `${store.url}|${levelIndex}|${fhour}${source === 'ML' ? '' : `|${source}`}`;

/** How many more frames of this level fit in the cache without dropping any. */
export function frameCacheRoom(store: PtypeStore, levelIndex: number): number {
  let used = 0;
  for (const n of frameSizes.values()) used += n;
  return Math.floor((MAX_FRAME_BYTES - used) / frameSize(store.levels[levelIndex], store.hasMask));
}

/** True when this frame is already in memory (or on its way). */
export function hasPtypeFrame(store: PtypeStore, levelIndex: number, fhour: number, source: PtypeSource = 'ML'): boolean {
  return frames.has(frameKey(store, levelIndex, fhour, source));
}

/** Read one forecast hour at one pyramid level (cached). */
export function readPtypeFrame(store: PtypeStore, levelIndex: number, fhour: number, source: PtypeSource = 'ML'): Promise<PtypeFrame> {
  const key = frameKey(store, levelIndex, fhour, source);
  const hit = frames.get(key);
  if (hit) {
    // Refresh recency, so the frame on screen is the last to be dropped.
    frames.delete(key);
    frames.set(key, hit);
    return hit;
  }
  const fhIndex = store.forecastHours.indexOf(fhour);
  if (fhIndex < 0) return Promise.reject(new Error(`Forecast hour ${fhour} is not in the store`));
  const level = store.levels[levelIndex];
  const p = Promise.all([
    Promise.all(
      [...PTYPE_CLASSES.map((c) => `${source}_${c}`), ...(source === 'ML' ? ['ML_u'] : [])].map((v) => readVar(store, level, v, fhIndex)),
    ),
    store.hasMask ? readMask(store, level, fhIndex) : undefined,
  ]).then(([[rain, snow, icep, frzr, u], mask]) => ({
    level,
    probs: { rain: quantizeProbability(rain), snow: quantizeProbability(snow), icep: quantizeProbability(icep), frzr: quantizeProbability(frzr) },
    u: u ? quantizeUncertainty(u) : new Uint16Array(0),
    mask,
  }));
  const drop = (k: string) => {
    frames.delete(k);
    frameSizes.delete(k);
  };
  p.catch(() => drop(key));
  frames.set(key, p);
  frameSizes.set(key, frameSize(level, store.hasMask));
  let used = 0;
  for (const n of frameSizes.values()) used += n;
  while (used > MAX_FRAME_BYTES && frames.size > 1) {
    const oldest = frames.keys().next().value!;
    used -= frameSizes.get(oldest) ?? 0;
    drop(oldest);
  }
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

/**
 * Forget every frame and open store except those of `keepUrl` (the selected run's store), so
 * the previous run's frames (2 to 40 MB each) can be garbage collected as soon as the run changes.
 */
export function releasePtypeExcept(keepUrl: string | null): void {
  for (const key of [...frames.keys()]) {
    if (keepUrl !== null && key.startsWith(`${keepUrl}|`)) continue;
    frames.delete(key);
    frameSizes.delete(key);
  }
  for (const url of [...stores.keys()]) if (url !== keepUrl) stores.delete(url);
}

/** What the caches hold: for the memory probe (`?memdebug`). */
export function ptypeCacheStats() {
  let bytes = 0;
  for (const n of frameSizes.values()) bytes += n;
  const runs = new Set([...frames.keys()].map((k) => k.split('|')[0]));
  return { frames: frames.size, framesMB: Math.round(bytes / 104857.6) / 10, stores: stores.size, runs: runs.size };
}
