/**
 * The precipitation mask: where the HRRR's composite reflectivity is above 0 dBZ.
 *
 * Reflectivity is an instantaneous field, so it is there at forecast hour 0. The
 * HRRR categorical types (and the `precip_mask` the stores carry, built from
 * them) are all zero in the analysis, which left hour 0 blank.
 *
 * The mask is a byte per cell of one pyramid level, far smaller than the 7.6 MB
 * decoded field, so masks are cached here and the field is released once the
 * mask is built unless the reflectivity layer itself is on.
 */
import { fetchHrrrMessage, releaseHrrrMessage, type HrrrMessage } from '../data/hrrr';
import type { PtypeLevel } from '../data/ptype';
import type { InitIso } from '../time/times';
import { precipMask } from './ptypeField';

export const REFC_SEARCH = ':REFC:entire atmosphere:';
/** Echoes weaker than this are not counted as precipitation. The HRRR writes -10 dBZ where there is no echo. */
export const REFC_THRESHOLD_DBZ = 0;

/** A full-resolution mask is 1.9 MB; this covers two 48-hour runs at that size in the worst case. */
const MAX_MASKS = 100;
const masks = new Map<string, Promise<Uint8Array>>();
const maskBytes = new Map<string, number>();

export function maskFromReflectivity(level: PtypeLevel, refc: HrrrMessage): Uint8Array {
  return precipMask(level.grid, [refc], REFC_THRESHOLD_DBZ);
}

/**
 * Mask for one forecast hour on one pyramid level. `keepField` leaves the decoded
 * reflectivity in the message cache (pass true when the reflectivity layer is shown).
 * `fetch` lets the background loader count the download against its budget.
 */
export function reflectivityMask(
  init: InitIso,
  fhour: number,
  level: PtypeLevel,
  keepField: boolean,
  fetch: (search: string) => Promise<HrrrMessage> = (search) => fetchHrrrMessage(init, fhour, search),
): Promise<Uint8Array> {
  const key = `${init}|${fhour}|${level.path}|${level.grid.ni}x${level.grid.nj}`;
  const hit = masks.get(key);
  if (hit) {
    masks.delete(key);
    masks.set(key, hit);
    return hit;
  }
  const p = fetch(REFC_SEARCH).then((refc) => {
    const mask = maskFromReflectivity(level, refc);
    if (!keepField) releaseHrrrMessage(init, fhour, REFC_SEARCH);
    if (masks.get(key) === p) maskBytes.set(key, mask.byteLength);
    return mask;
  });
  p.catch(() => masks.delete(key));
  masks.set(key, p);
  if (masks.size > MAX_MASKS) masks.delete(masks.keys().next().value!);
  return p;
}

/** Forget the masks of every run but `init`. */
export function releaseMasksExcept(init: InitIso | null): void {
  for (const key of [...masks.keys()]) if (init === null || !key.startsWith(`${init}|`)) masks.delete(key);
}

/** What the cache holds: for the memory probe (`?memdebug`). */
export function maskCacheStats() {
  let bytes = 0;
  for (const key of [...maskBytes.keys()]) {
    if (masks.has(key)) bytes += maskBytes.get(key)!;
    else maskBytes.delete(key);
  }
  return { masks: masks.size, masksMB: Math.round(bytes / 104857.6) / 10, runs: new Set([...masks.keys()].map((k) => k.split('|')[0])).size };
}
