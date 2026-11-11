/** Reads point soundings from the (init_time, forecast_hour, location, variable) Zarr store. */
import * as zarr from 'zarrita';
import { dataSources } from '../config/dataSources';
import { Lambert, cellLonLat, nearestCell, type GridDef } from '../geo/lambert';
import type { Profile } from '../sounding/profile';
import { initDate, type InitIso } from '../time/times';

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
  /** Init times as seconds since the epoch. */
  initTimes: number[];
  forecastHours: number[];
}

export interface SoundingResult {
  profile: Profile;
  /** Centre of the grid cell the sounding came from. */
  lon: number;
  lat: number;
}

let opening: Promise<SoundingStore> | null = null;

async function open(): Promise<SoundingStore> {
  const root = await zarr.open.v3(new zarr.FetchStore(dataSources.soundingStore), { kind: 'group' });
  const attrs = root.attrs as { grid?: GridAttrs; heights_m?: number[]; variable_groups?: string[] };
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
  const [array, initTimes, forecastHours] = await Promise.all([
    zarr.open.v3(root.resolve('sounding'), { kind: 'array' }),
    coord('init_time'),
    coord('forecast_hour'),
  ]);
  return { array, grid, proj: new Lambert(grid), heights: attrs.heights_m, groups: attrs.variable_groups, initTimes, forecastHours };
}

function store(): Promise<SoundingStore> {
  if (!opening) {
    opening = open().catch((err) => {
      opening = null;
      throw err;
    });
  }
  return opening;
}

export class SoundingUnavailable extends Error {}

/** Read the sounding at the grid cell nearest to (lon, lat). */
export async function readSounding(init: InitIso, fhour: number, lon: number, lat: number): Promise<SoundingResult> {
  const s = await store();
  const cell = nearestCell(s.grid, lon, lat, s.proj);
  if (!cell) throw new SoundingUnavailable('That point is outside the forecast domain.');
  const ti = s.initTimes.indexOf(Math.round(initDate(init).getTime() / 1000));
  const fi = s.forecastHours.indexOf(fhour);
  if (ti < 0 || fi < 0) throw new SoundingUnavailable('No sounding is stored for this run and forecast hour.');

  const { data } = await zarr.get(s.array, [ti, fi, cell.index, null]);
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
    },
  };
}
