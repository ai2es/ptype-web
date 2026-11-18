/** The list of runs that have precipitation-type forecasts (inits.json in the ptype bucket). */
import { dataSources } from '../config/dataSources';
import { normalizeInit, type InitIso } from '../time/times';

export interface ManifestEntry {
  init: InitIso;
  /** Forecast hours present in the store, ascending. */
  forecastHours: number[];
  /** Store location relative to the ptype root (or an absolute URL). */
  store: string;
  /** Sounding store of this run, relative to the sounding root (or an absolute URL). */
  soundings: string;
}

export type Manifest = Map<InitIso, ManifestEntry>;

interface RawEntry {
  init: string;
  forecast_hours?: number[];
  max_forecast_hour?: number;
  store?: string;
  soundings?: string;
}

/** Default store path for a run when the manifest does not give one. */
export function defaultStorePath(init: InitIso): string {
  const day = init.slice(0, 10);
  return `${day.replace(/-/g, '/')}/hrrr_ptype_${day.replace(/-/g, '')}_${init.slice(11, 13)}00.zarr`;
}

/** Default sounding store path for a run when the manifest does not give one. */
export function defaultSoundingPath(init: InitIso): string {
  const day = init.slice(0, 10);
  return `soundings/${day.replace(/-/g, '/')}/hrrr_soundings_${day.replace(/-/g, '')}_${init.slice(11, 13)}00.zarr`;
}

export function parseManifest(json: { inits?: RawEntry[] }): Manifest {
  const out: Manifest = new Map();
  for (const raw of json.inits ?? []) {
    const init = normalizeInit(raw.init);
    const hours =
      raw.forecast_hours ??
      Array.from({ length: raw.max_forecast_hour ?? 18 }, (_, k) => k + 1);
    out.set(init, {
      init,
      forecastHours: [...hours].sort((a, b) => a - b),
      store: raw.store ?? defaultStorePath(init),
      soundings: raw.soundings ?? defaultSoundingPath(init),
    });
  }
  return out;
}

export async function fetchManifest(): Promise<Manifest> {
  const resp = await fetch(`${dataSources.ptypeRoot}/inits.json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Could not load the forecast list (HTTP ${resp.status})`);
  return parseManifest(await resp.json());
}

/** True when two indexes list the same runs with the same hours and store paths. */
export function manifestsEqual(a: Manifest, b: Manifest): boolean {
  if (a.size !== b.size) return false;
  for (const [init, x] of a) {
    const y = b.get(init);
    if (!y || x.store !== y.store || x.soundings !== y.soundings || x.forecastHours.length !== y.forecastHours.length) return false;
    if (x.forecastHours.some((h, k) => h !== y.forecastHours[k])) return false;
  }
  return true;
}

/**
 * What the index says about a set of forecasts, as a string, for use as an effect dependency.
 *
 * With realtime runs the index changes every minute or two (a run somewhere gains an hour). Effects that
 * depended on the index object itself would then reload the frame on screen, the sounding (dropping the
 * user's edits) and the preload on every change, whichever run it concerned. They depend on this instead,
 * built from only the runs and the fields they use.
 */
export function manifestKey(manifest: Manifest | null, frames: { init: InitIso; fhour: number }[], what: (entry: ManifestEntry, fhour: number) => string): string {
  if (!manifest) return 'no-index';
  return frames.map((f) => {
    const entry = manifest.get(f.init);
    return entry ? what(entry, f.fhour) : '-';
  }).join(';');
}

/** For `manifestKey`: where the run's gridded store is and whether it has this forecast hour. */
export const storeAndHour = (entry: ManifestEntry, fhour: number) => `${entry.store}:${entry.forecastHours.includes(fhour) ? 1 : 0}`;
/** For `manifestKey`: where the run's sounding store is. */
export const soundingsOnly = (entry: ManifestEntry) => entry.soundings;
/** For `manifestKey`: sounding store and whether the run has this forecast hour. */
export const soundingsAndHour = (entry: ManifestEntry, fhour: number) => `${entry.soundings}:${entry.forecastHours.includes(fhour) ? 1 : 0}`;

export function storeUrl(entry: ManifestEntry): string {
  return /^https?:/.test(entry.store) ? entry.store : `${dataSources.ptypeRoot}/${entry.store}`;
}

export function soundingUrl(entry: ManifestEntry): string {
  if (/^https?:/.test(entry.soundings)) return entry.soundings;
  // A root that is itself a store serves every run (the bundled sample data).
  const root = dataSources.soundingRoot;
  return root.endsWith('.zarr') ? root : `${root}/${entry.soundings}`;
}
