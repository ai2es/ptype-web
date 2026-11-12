/** The list of runs that have precipitation-type forecasts (inits.json in the ptype bucket). */
import { dataSources } from '../config/dataSources';
import { normalizeInit, type InitIso } from '../time/times';

export interface ManifestEntry {
  init: InitIso;
  /** Forecast hours present in the store, ascending. */
  forecastHours: number[];
  /** Store location relative to the ptype root (or an absolute URL). */
  store: string;
}

export type Manifest = Map<InitIso, ManifestEntry>;

interface RawEntry {
  init: string;
  forecast_hours?: number[];
  max_forecast_hour?: number;
  store?: string;
}

/** Default store path for a run when the manifest does not give one. */
export function defaultStorePath(init: InitIso): string {
  const day = init.slice(0, 10);
  return `${day.replace(/-/g, '/')}/hrrr_ptype_${day.replace(/-/g, '')}_${init.slice(11, 13)}00.zarr`;
}

export function parseManifest(json: { inits?: RawEntry[] }): Manifest {
  const out: Manifest = new Map();
  for (const raw of json.inits ?? []) {
    const init = normalizeInit(raw.init);
    const hours =
      raw.forecast_hours ??
      Array.from({ length: raw.max_forecast_hour ?? 18 }, (_, k) => k + 1);
    out.set(init, { init, forecastHours: [...hours].sort((a, b) => a - b), store: raw.store ?? defaultStorePath(init) });
  }
  return out;
}

export async function fetchManifest(): Promise<Manifest> {
  const resp = await fetch(`${dataSources.ptypeRoot}/inits.json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Could not load the forecast list (HTTP ${resp.status})`);
  return parseManifest(await resp.json());
}

export function storeUrl(entry: ManifestEntry): string {
  return /^https?:/.test(entry.store) ? entry.store : `${dataSources.ptypeRoot}/${entry.store}`;
}
