/**
 * Reads point soundings. Each run has its own Zarr store holding a
 * (forecast_hour, location, variable) array, so a click costs one small range
 * read. The older single-store layout with a leading init_time dimension (the
 * bundled sample data) is still understood.
 */
import * as zarr from 'zarrita';
import { Lambert, cellLonLat, nearestCell, type GridDef } from '../geo/lambert';
import type { Profile } from '../sounding/profile';
import { initDate } from '../time/times';
import { soundingUrl, type ManifestEntry } from './manifest';

interface GridAttrs {
  ni: number; nj: number; dx: number; dy: number; ll_x: number; ll_y: number;
  lon_0: number; lat_0: number; lat_std: [number, number]; earth_radius: number;
}

interface SoundingStore {
  array: zarr.Array<zarr.DataType, zarr.FetchStore>;
  grid: GridDef;
  proj: Lambert;
  heights: number[];
  groups: string[];
  /** Init times as seconds since the epoch; null when the store holds a single run. */
  initTimes: number[] | null;
  forecastHours: number[];
  /** True when u and v are stored earth-relative and must be rotated for the network. */
  earthRelative: boolean;
}

export interface SoundingResult {
  profile: Profile;
  /** Centre of the grid cell the sounding came from. */
  lon: number;
  lat: number;
}

async function open(url: string): Promise<SoundingStore> {
  const root = await zarr.open.v3(new zarr.FetchStore(url), { kind: 'group' });
  const attrs = root.attrs as { grid?: GridAttrs; heights_m?: number[]; variable_groups?: string[]; wind_frame?: string };
  if (!attrs.grid || !attrs.heights_m || !attrs.variable_groups) {
    throw new Error('Sounding store is missing grid / heights_m / variable_groups attributes');
  }
  const g = attrs.grid;
  const grid: GridDef = {
    ni: g.ni, nj: g.nj, dx: g.dx, dy: g.dy, llX: g.ll_x, llY: g.ll_y,
    lon0: g.lon_0, lat0: g.lat_0, latStd: g.lat_std, radius: g.earth_radius,
  };
  const coord = async (name: string) => {
    const arr = await zarr.open.v3(root.resolve(name), { kind: 'array' });
    return Array.from((await zarr.get(arr)).data as ArrayLike<number | bigint>, Number);
  };
  const array = await zarr.open.v3(root.resolve('sounding'), { kind: 'array' });
  // Four dimensions means the old layout with init_time first; per-run stores have three.
  const [initTimes, forecastHours] = await Promise.all([array.shape.length === 4 ? coord('init_time') : null, coord('forecast_hour')]);
  return {
    array, grid, proj: new Lambert(grid), heights: attrs.heights_m, groups: attrs.variable_groups,
    initTimes, forecastHours, earthRelative: attrs.wind_frame === 'earth_relative',
  };
}

// Opening a store costs a few small requests; keep the last few runs so stepping
// through forecast hours, or flipping between two runs, does not repeat them.
const stores = new Map<string, Promise<SoundingStore>>();
const MAX_STORES = 4;

function store(url: string): Promise<SoundingStore> {
  let p = stores.get(url);
  if (!p) {
    p = open(url).catch((err) => {
      stores.delete(url);
      throw err;
    });
    stores.set(url, p);
    if (stores.size > MAX_STORES) stores.delete(stores.keys().next().value!);
  }
  return p;
}

/**
 * Angle (radians) by which grid +y points east of true north at a longitude,
 * for a Lambert conformal grid tangent at latStd: the cone constant times the
 * longitude difference from the central meridian.
 */
export function gridAngle(lon: number, lon0: number, latStd: number): number {
  const dlon = ((((lon - lon0 + 180) % 360) + 360) % 360) - 180;
  return Math.sin((latStd * Math.PI) / 180) * ((dlon * Math.PI) / 180);
}

export class SoundingUnavailable extends Error {}

/** Read the sounding at the grid cell nearest to (lon, lat). */
export async function readSounding(entry: ManifestEntry, fhour: number, lon: number, lat: number): Promise<SoundingResult> {
  const s = await store(soundingUrl(entry));
  const cell = nearestCell(s.grid, lon, lat, s.proj);
  if (!cell) throw new SoundingUnavailable('That point is outside the forecast domain.');
  const ti = s.initTimes ? s.initTimes.indexOf(Math.round(initDate(entry.init).getTime() / 1000)) : 0;
  const fi = s.forecastHours.indexOf(fhour);
  if (ti < 0 || fi < 0) throw new SoundingUnavailable('No sounding is stored for this run and forecast hour.');

  const { data } = await zarr.get(s.array, s.initTimes ? [ti, fi, cell.index, null] : [fi, cell.index, null]);
  const values = Array.from(data as ArrayLike<number>);
  if (values.every((v) => Number.isNaN(v))) throw new SoundingUnavailable('No sounding is stored at this point.');
  const n = s.heights.length;
  const group = (name: string) => {
    const g = s.groups.indexOf(name);
    if (g < 0) throw new Error(`Sounding store has no "${name}" variable group`);
    return values.slice(g * n, (g + 1) * n);
  };
  const [clon, clat] = cellLonLat(s.grid, cell.i, cell.j, s.proj);
  return {
    lon: clon,
    lat: clat,
    profile: {
      heights: [...s.heights],
      t: group('temperature_c'),
      td: group('dewpoint_c'),
      u: group('u_ms'),
      v: group('v_ms'),
      p: group('pressure_hpa'),
      gridAngle: s.earthRelative ? gridAngle(clon, s.grid.lon0, s.grid.latStd[0]) : undefined,
    },
  };
}
