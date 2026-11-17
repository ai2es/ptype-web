/**
 * Fetches individual HRRR fields straight from NOAA's public bucket: the .idx
 * inventory locates each GRIB2 message, a byte-range request downloads just
 * that message, and gribjs decodes it in the browser.
 */
import { Grib2Inventory } from '../vendor/gribjs/ts/index';
import { isLowMemoryDevice } from '../config/device';
import { hrrrGribUrl, type InitIso } from '../time/times';

export interface HrrrGridInfo {
  ni: number;
  nj: number;
  lon0: number;
  lat0: number;
  latStd: [number, number];
  llLon: number;
  llLat: number;
  dx: number;
  dy: number;
}

export interface HrrrMessage {
  data: Float32Array;
  grid: HrrrGridInfo;
}

export class HrrrUnavailable extends Error {}

const inventories = new Map<string, Promise<Grib2Inventory>>();
const messages = new Map<string, Promise<HrrrMessage>>();
/** Decoded bytes of each cached message, filled in as downloads finish (for the memory probe). */
const messageBytes = new Map<string, number>();
/**
 * Each decoded CONUS field is about 7.6 MB. The cache is sized so that a whole
 * run of a couple of fields can be held for animation (see data/prefetch.ts):
 * about 0.6 GB on a desktop and about 0.12 GB on phones and tablets (see config/device.ts).
 */
const MAX_MESSAGES = isLowMemoryDevice() ? 16 : 80;

/** How many decoded messages the cache holds before the oldest is dropped. */
export function messageCacheCapacity(): number {
  return MAX_MESSAGES;
}

function inventory(url: string): Promise<Grib2Inventory> {
  let p = inventories.get(url);
  if (!p) {
    p = fetch(`${url}.idx`).then(async (resp) => {
      if (!resp.ok) throw new HrrrUnavailable(`HRRR file not available (HTTP ${resp.status})`);
      return Grib2Inventory.parse(await resp.text());
    });
    p.catch(() => inventories.delete(url));
    inventories.set(url, p);
    if (inventories.size > 200) inventories.delete(inventories.keys().next().value!);
  }
  return p;
}

async function download(url: string, search: string): Promise<HrrrMessage> {
  const inv = (await inventory(url)).search(search);
  if (inv.entries.length === 0) throw new HrrrUnavailable(`No GRIB message matching "${search}"`);
  // Keep only the first match so one request returns one message.
  const file = await new Grib2Inventory([inv.entries[0]]).downloadData(url);
  const msg = await file.getMessage(0);
  const dims = msg.getGridDimensions();
  const gp = msg.getGridParameters();
  if (gp.projection !== 'LambertConformal') throw new Error(`Unexpected HRRR projection ${gp.projection}`);
  const lon = (v: number) => (v > 180 ? v - 360 : v);
  return {
    data: msg.data,
    grid: {
      ni: dims.ngrid_i,
      nj: dims.ngrid_j,
      lon0: lon(gp.standard_lon),
      lat0: gp.center_lat,
      latStd: [gp.standard_lat_1, gp.standard_lat_2],
      llLon: lon(gp.lon_first),
      llLat: gp.lat_first,
      dx: gp.dx,
      dy: gp.dy,
    },
  };
}

/**
 * One decoded HRRR field. `search` is matched against the wgrib2-style
 * inventory line, e.g. ":TMP:2 m above ground:".
 */
export function fetchHrrrMessage(init: InitIso, fhour: number, search: string): Promise<HrrrMessage> {
  const url = hrrrGribUrl(init, fhour);
  const key = `${url}|${search}`;
  const hit = messages.get(key);
  if (hit) {
    // Refresh recency.
    messages.delete(key);
    messages.set(key, hit);
    return hit;
  }
  const p = download(url, search);
  p.then((m) => messages.get(key) === p && messageBytes.set(key, m.data.byteLength)).catch(() => messages.delete(key));
  messages.set(key, p);
  if (messages.size > MAX_MESSAGES) messages.delete(messages.keys().next().value!);
  return p;
}

/** Forget a decoded message, once whatever needed its values has been built. */
export function releaseHrrrMessage(init: InitIso, fhour: number, search: string): void {
  messages.delete(`${hrrrGribUrl(init, fhour)}|${search}`);
}

/**
 * Forget everything that does not belong to `init`: decoded messages (about 7.6 MB each) and file
 * inventories. Called when the user selects another run, so the old run's fields can be garbage
 * collected at once instead of waiting to be pushed out one by one.
 */
export function releaseHrrrExcept(init: InitIso | null): void {
  // Every file of a run shares this prefix; the forecast hour comes after it.
  const keep = init === null ? null : hrrrGribUrl(init, 0).replace(/\d+\.grib2$/, '');
  for (const key of [...messages.keys()]) if (keep === null || !key.startsWith(keep)) messages.delete(key);
  for (const url of [...inventories.keys()]) if (keep === null || !url.startsWith(keep)) inventories.delete(url);
}

/** True when the run's file for this forecast hour exists on the bucket. */
export async function hrrrAvailable(init: InitIso, fhour: number): Promise<boolean> {
  try {
    await inventory(hrrrGribUrl(init, fhour));
    return true;
  } catch {
    return false;
  }
}

/** What the caches hold: for the memory probe (`?memdebug`). */
export function hrrrCacheStats() {
  let bytes = 0;
  for (const key of [...messageBytes.keys()]) {
    if (messages.has(key)) bytes += messageBytes.get(key)!;
    else messageBytes.delete(key);
  }
  const runs = new Set([...messages.keys()].map((k) => k.split('/conus/')[0].slice(-8) + k.split('.t')[1]?.slice(0, 2)));
  return { messages: messages.size, messagesMB: Math.round(bytes / 104857.6) / 10, inventories: inventories.size, runs: runs.size };
}
