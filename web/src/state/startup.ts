/** Chooses the run shown on first load and keeps the URL in step with the state. */
import { hrrrAvailable } from '../data/hrrr';
import { fetchManifest } from '../data/manifest';
import { FIELD_BY_ID } from '../fields/registry';
import { normalizeInit, shiftInit, toInitIso, type InitIso } from '../time/times';
import { maxFhour, useApp } from './store';

/** Most recent HRRR run whose first forecast hour is on the NOAA bucket. */
export async function latestHrrrInit(): Promise<InitIso> {
  let init = toInitIso(new Date());
  for (let k = 0; k < 8; k++) {
    if (await hrrrAvailable(init, 1)) return init;
    init = shiftInit(init, -1);
  }
  return init;
}

function readUrl() {
  const q = new URLSearchParams(window.location.search);
  const patch: Partial<ReturnType<typeof useApp.getState>> = {};
  let init: InitIso | null = null;
  try {
    const raw = q.get('init');
    if (raw) init = normalizeInit(raw);
  } catch {
    init = null;
  }
  const lat = Number(q.get('lat'));
  const lon = Number(q.get('lon'));
  if (q.has('lat') && q.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) patch.point = { lat, lon };
  if (q.has('fields')) patch.activeFields = q.get('fields')!.split(',').filter((id) => FIELD_BY_ID.has(id));
  const fh = Number(q.get('fh'));
  return { init, fhour: q.has('fh') && Number.isInteger(fh) && fh >= 0 ? fh : null, patch };
}

function writeUrl() {
  const s = useApp.getState();
  if (!s.init) return;
  const q = new URLSearchParams();
  q.set('init', s.init);
  q.set('fh', String(s.fhour));
  if (s.point) {
    q.set('lat', s.point.lat.toFixed(3));
    q.set('lon', s.point.lon.toFixed(3));
  }
  q.set('fields', s.activeFields.join(','));
  window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
}

export async function startApp(): Promise<void> {
  const app = useApp.getState();
  const url = readUrl();
  app.set(url.patch);

  let latestPtype: InitIso | null = null;
  try {
    const manifest = await fetchManifest();
    app.setManifest(manifest);
    latestPtype = [...manifest.keys()].sort().at(-1) ?? null;
  } catch (err) {
    app.setManifest(null, err instanceof Error ? err.message : String(err));
  }

  const init = url.init ?? latestPtype ?? (await latestHrrrInit());
  const entry = useApp.getState().manifest?.get(init);
  const fhour = url.fhour ?? entry?.forecastHours[0] ?? 1;
  useApp.getState().setInit(init);
  useApp.getState().setFhour(Math.min(fhour, maxFhour(init)));

  let timer = 0;
  useApp.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(writeUrl, 250);
  });
  writeUrl();
}
