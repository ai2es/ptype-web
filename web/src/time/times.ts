/** Init-time helpers. Init times are ISO strings in UTC, e.g. "2024-04-30T00:00Z". */
import { dataSources } from '../config/dataSources';

export type InitIso = string;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toInitIso(d: Date): InitIso {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00Z`;
}

export function normalizeInit(iso: string): InitIso {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid init time "${iso}"`);
  return toInitIso(d);
}

export function initDate(iso: InitIso): Date {
  return new Date(iso);
}

export function makeInit(year: number, month1: number, day: number, hour: number): InitIso {
  return toInitIso(new Date(Date.UTC(year, month1 - 1, day, hour)));
}

/** "2024-04-30" part of an init time. */
export const initDay = (iso: InitIso) => iso.slice(0, 10);
export const initHour = (iso: InitIso) => Number(iso.slice(11, 13));

/** HRRR runs out to 48 h at 00/06/12/18 UTC and 18 h at every other hour. */
export function maxForecastHour(hourUtc: number): number {
  return hourUtc % 6 === 0 ? 48 : 18;
}

export function shiftInit(iso: InitIso, hours: number): InitIso {
  return toInitIso(new Date(initDate(iso).getTime() + hours * 3600_000));
}

export function validDate(iso: InitIso, fhour: number): Date {
  return new Date(initDate(iso).getTime() + fhour * 3600_000);
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatUtc(d: Date): string {
  return `${DOW[d.getUTCDay()]} ${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:00 UTC`;
}

export function formatInit(iso: InitIso): string {
  return `${initDay(iso)} ${pad(initHour(iso))}Z`;
}

/** URL of the HRRR surface GRIB2 file for a run and forecast hour on NOAA's bucket. */
export function hrrrGribUrl(iso: InitIso, fhour: number): string {
  const ymd = initDay(iso).replace(/-/g, '');
  return `${dataSources.hrrrRoot}/hrrr.${ymd}/conus/hrrr.t${pad(initHour(iso))}z.wrfsfcf${pad(fhour)}.grib2`;
}
