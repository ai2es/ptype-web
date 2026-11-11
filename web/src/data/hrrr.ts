/**
 * Fetches individual HRRR fields straight from NOAA's public bucket: the .idx
 * inventory locates each GRIB2 message, a byte-range request downloads just
 * that message, and gribjs decodes it in the browser.
 */
import { Grib2Inventory } from '../vendor/gribjs/ts/index';
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
/** Each decoded CONUS field is about 7.6 MB, so keep the cache modest. */
const MAX_MESSAGES = 36;

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
  p.catch(() => messages.delete(key));
  messages.set(key, p);
  if (messages.size > MAX_MESSAGES) messages.delete(messages.keys().next().value!);
  return p;
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
