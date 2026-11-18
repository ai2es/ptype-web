/** Keeps the run index current while the page is open (kept apart from startup.ts so it can be tested without the map). */
import { fetchManifest, manifestsEqual, type Manifest } from '../data/manifest';
import { useApp } from './store';

/** How often the run index is re-read while the page is open and visible. */
export const MANIFEST_REFRESH_MS = 120_000;

/**
 * Re-read the run index and adopt it if it changed; returns whether it did.
 *
 * Realtime runs gain forecast hours, appear, and move from a staging store to their final one while a page
 * is open. A failed read changes nothing: one bad poll must not blank the map or raise the banner. An
 * unchanged index is not adopted, so nothing that depends on it re-runs.
 */
export async function refreshManifest(fetcher: () => Promise<Manifest> = fetchManifest): Promise<boolean> {
  let next: Manifest;
  try {
    next = await fetcher();
  } catch {
    return false;
  }
  const current = useApp.getState().manifest;
  if (current && manifestsEqual(current, next)) return false;
  useApp.getState().setManifest(next);
  return true;
}

/** Poll the index while the tab is visible, and once when it becomes visible again after a pause. */
export function watchManifest(): void {
  let last = Date.now();
  const poll = () => {
    if (document.visibilityState !== 'visible') return;
    last = Date.now();
    void refreshManifest();
  };
  window.setInterval(poll, MANIFEST_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (Date.now() - last >= MANIFEST_REFRESH_MS) poll();
  });
}
