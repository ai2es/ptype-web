/**
 * Model trend ("dprog/dt"): the forecasts of every HRRR run that are valid at one time.
 *
 * The app describes what is on screen with a run and a forecast hour in both modes; in trend mode the
 * two change together so that their sum, the valid time, stays fixed. That keeps the map, the hover
 * readout and the sounding panel unaware of the mode.
 */
import type { Manifest } from '../data/manifest';
import { initDate, initHour, maxForecastHour, shiftInit, toInitIso, validDate, type InitIso } from './times';

/** One forecast: a run and a forecast hour of it. */
export interface Frame {
  init: InitIso;
  fhour: number;
}

/** A run to hold on to, or just one forecast hour of it. */
export interface KeepFrame {
  init: InitIso;
  fhour?: number;
}

/** Longest HRRR forecast. */
export const MAX_LEAD = 48;

/** Valid time of a forecast, in the same form as an init time. */
export function validIso(init: InitIso, fhour: number): InitIso {
  return toInitIso(validDate(init, fhour));
}

/**
 * Every run with a forecast valid at `valid`, longest lead first and the analysis (F00) last.
 * Hourly runs reach 18 h and the 00/06/12/18 UTC runs 48 h, so a past valid time has 24 frames:
 * five between F48 and F19, then F18 to F00. Runs that start after `now` do not exist yet.
 */
export function trendFrames(valid: InitIso, now: Date = new Date()): Frame[] {
  const frames: Frame[] = [];
  for (let lead = MAX_LEAD; lead >= 0; lead--) {
    const init = shiftInit(valid, -lead);
    if (lead > maxForecastHour(initHour(init))) continue;
    if (initDate(init).getTime() > now.getTime()) continue;
    frames.push({ init, fhour: lead });
  }
  return frames;
}

/** Forecast hours of one run as frames. */
export function runFrames(init: InitIso): Frame[] {
  return Array.from({ length: maxForecastHour(initHour(init)) + 1 }, (_, fhour) => ({ init, fhour }));
}

/**
 * Which positions of a loop to label on an axis: every six hours of lead, but only every twelve beyond
 * 24 h, where a trend loop's frames are six hours apart and the labels would touch. Always the first.
 */
export function leadLabels(leads: number[]): { index: number; text: string }[] {
  return leads.flatMap((lead, index) => (index === 0 || (lead % 6 === 0 && (lead <= 24 || lead % 12 === 0)) ? [{ index, text: String(lead) }] : []));
}

/** Frame of `frames` whose lead is nearest to `fhour`; -1 when there are none. */
export function nearestFrame(frames: Frame[], fhour: number): number {
  let best = -1;
  frames.forEach((f, k) => {
    if (best < 0 || Math.abs(f.fhour - fhour) < Math.abs(frames[best].fhour - fhour)) best = k;
  });
  return best;
}

/** Valid times covered by at least one run that has a precipitation-type forecast. */
export function validTimes(manifest: Manifest | null): Set<InitIso> {
  const hours = new Set<number>();
  for (const entry of manifest?.values() ?? []) {
    const base = Math.round(initDate(entry.init).getTime() / 3600_000);
    for (const fh of entry.forecastHours) hours.add(base + fh);
  }
  return new Set([...hours].map((h) => toInitIso(new Date(h * 3600_000))));
}

/** True when `keep` covers this forecast (an entry without a forecast hour covers its whole run). */
export function isKept(keep: KeepFrame[], init: InitIso, fhour: number): boolean {
  return keep.some((k) => k.init === init && (k.fhour === undefined || k.fhour === fhour));
}
