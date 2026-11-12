/** Sounding profile type and the editing maths (ported from the original sounding.js). */

export interface Profile {
  /** Heights above ground, metres, surface first. */
  heights: number[];
  /** Temperature, deg C. */
  t: number[];
  /** Dewpoint, deg C. */
  td: number[];
  /** Wind components, m/s. */
  u: number[];
  v: number[];
  /** Pressure, hPa (used only to place levels on the skew-T). */
  p: number[];
}

export type ProfileVar = 't' | 'td' | 'u' | 'v';

export function cloneProfile(p: Profile): Profile {
  return { heights: [...p.heights], t: [...p.t], td: [...p.td], u: [...p.u], v: [...p.v], p: [...p.p] };
}

/** Saturation vapour pressure (hPa) from temperature (deg C), Magnus form. */
export const satVapPres = (tC: number) => 6.112 * Math.exp((17.67 * tC) / (tC + 243.5));

/** Inverse of satVapPres. */
export function dewpointFromVapPres(e: number): number {
  const l = Math.log(e / 6.112);
  return (-243.5 * l) / (l - 17.67);
}

/**
 * Weight of an edit made at level `idx` on level `i`: a Gaussian in level
 * index. sigma = 0 edits a single level.
 */
export function influence(i: number, idx: number, sigma: number): number {
  if (sigma <= 0) return i === idx ? 1 : 0;
  return Math.exp(-0.5 * ((i - idx) / sigma) ** 2);
}

export function spreadDelta(values: number[], idx: number, delta: number, sigma: number): number[] {
  return values.map((v, i) => v + delta * influence(i, idx, sigma));
}

export interface EditOptions {
  /** Gaussian width in levels over which a drag is spread. */
  sigma: number;
  /** Keep relative humidity constant when temperature or dewpoint is dragged. */
  lockRh: boolean;
}

/**
 * Apply a temperature or dewpoint drag to `start` (the profile when the drag
 * began). Dewpoint is never allowed above temperature.
 */
export function editThermo(start: Profile, which: 't' | 'td', idx: number, delta: number, opts: EditOptions): Profile {
  const out = cloneProfile(start);
  const rh = start.t.map((t, i) => satVapPres(start.td[i]) / satVapPres(t));
  if (which === 't') {
    out.t = spreadDelta(start.t, idx, delta, opts.sigma);
    if (opts.lockRh) out.td = out.t.map((t, i) => dewpointFromVapPres(satVapPres(t) * rh[i]));
  } else {
    out.td = spreadDelta(start.td, idx, delta, opts.sigma);
    if (opts.lockRh) out.t = out.td.map((td, i) => dewpointFromVapPres(satVapPres(td) / rh[i]));
  }
  out.td = out.td.map((td, i) => Math.min(td, out.t[i]));
  return out;
}

/** Apply a hodograph drag (du, dv in m/s) at level `idx`. */
export function editWind(start: Profile, idx: number, du: number, dv: number, opts: EditOptions): Profile {
  const out = cloneProfile(start);
  out.u = spreadDelta(start.u, idx, du, opts.sigma);
  out.v = spreadDelta(start.v, idx, dv, opts.sigma);
  return out;
}

export function profilesEqual(a: Profile, b: Profile, tol = 1e-6): boolean {
  return (['t', 'td', 'u', 'v'] as const).every((k) => a[k].every((x, i) => Math.abs(x - b[k][i]) <= tol));
}
