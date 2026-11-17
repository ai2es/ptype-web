/**
 * Loads the selected gridded fields for every forecast hour of the selected
 * run in the background, so stepping or animating shows frames from memory.
 *
 * It only fills the caches the map already reads (decoded HRRR messages and
 * precipitation-type frames); nothing else has to know it exists. Hours are
 * taken in the order they are most likely to be needed, starting just after
 * the current one and wrapping round, two at a time so the frame on screen is
 * not starved of connections. A decoded CONUS field is several megabytes, so
 * loading stops at the caches' size instead of evicting what it just fetched.
 */
import type { HrrrMessage } from './hrrr';

export interface PrefetchPlan {
  /** Identifies what is being loaded; progress reports carry it back. */
  key: string;
  /** Forecast hours to load, nearest first. */
  hours: number[];
  /** HRRR messages the cache can hold for this plan (its capacity less what the frame on screen needs). */
  messageBudget: number;
  /**
   * Load everything one hour needs. HRRR messages must be requested through
   * `fetch` so they are counted. Resolve to false when the hour was skipped
   * because a cache is full.
   */
  loadHour(fhour: number, fetch: (search: string) => Promise<HrrrMessage>): Promise<boolean>;
  /** Fetches one HRRR message of this run. */
  fetchMessage(fhour: number, search: string): Promise<HrrrMessage>;
}

export interface PrefetchProgress {
  key: string;
  /** Hours whose data is in memory. */
  ready: number[];
  /** Hours that could not be loaded (file not on the bucket yet, network error). */
  failed: number[];
  /** True while hours are still being loaded. */
  active: boolean;
  /** True when loading stopped early because a cache was full. */
  limited: boolean;
}

/** Forecast hours of a run in loading order: after the current hour, then wrapping to the start. */
export function prefetchOrder(current: number, hours: number[]): number[] {
  const sorted = [...hours].sort((a, b) => a - b);
  return [...sorted.filter((h) => h > current), ...sorted.filter((h) => h < current)];
}

const CONCURRENT_HOURS = 2;

let generation = 0;

/** Stop the loader. The caches keep what they have. */
export function stopPrefetch() {
  generation++;
}

/** Start loading `plan` in the background, replacing any earlier plan. `onProgress` is called after every hour. */
export function startPrefetch(plan: PrefetchPlan, onProgress: (p: PrefetchProgress) => void): void {
  const gen = ++generation;
  const ready: number[] = [];
  const failed: number[] = [];
  const queue = [...plan.hours];
  const requested = new Set<string>();
  let limited = false;
  let running = 0;
  // Messages one hour needs, learned as hours load (fields can share a message).
  let perHour = 0;

  const report = () => {
    if (gen === generation) onProgress({ key: plan.key, ready: [...ready], failed: [...failed], active: running > 0 || queue.length > 0, limited });
  };
  const stopForSpace = () => {
    limited = true;
    queue.length = 0;
  };

  const next = () => {
    if (gen !== generation) return;
    while (running < CONCURRENT_HOURS && queue.length > 0) {
      // Would the next hours push earlier ones out of the message cache? Hours in flight count too.
      if (requested.size + perHour * (running + 1) > plan.messageBudget) {
        stopForSpace();
        break;
      }
      const fhour = queue.shift()!;
      const mine = new Set<string>();
      running++;
      plan
        .loadHour(fhour, (search) => {
          mine.add(search);
          requested.add(`${fhour}|${search}`);
          return plan.fetchMessage(fhour, search);
        })
        .then(
          (loaded) => {
            if (loaded) ready.push(fhour);
            else stopForSpace();
          },
          () => failed.push(fhour),
        )
        .finally(() => {
          perHour = Math.max(perHour, mine.size);
          running--;
          report();
          next();
        });
    }
  };
  report();
  next();
}
