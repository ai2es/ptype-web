/** Small array helpers used to prepare HRRR fields for plotting. */
import type { HrrrGridInfo, HrrrMessage } from '../data/hrrr';

/** Separable box blur, repeated `passes` times (approximates a Gaussian). NaNs are ignored. */
export function smooth(values: Float32Array, ni: number, nj: number, radius: number, passes = 2): Float32Array {
  let src = values;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(src.length);
    const dst = new Float32Array(src.length);
    for (let j = 0; j < nj; j++) blurLine(src, tmp, j * ni, 1, ni, radius);
    for (let i = 0; i < ni; i++) blurLine(tmp, dst, i, ni, nj, radius);
    src = dst;
  }
  return src;
}

function blurLine(src: Float32Array, dst: Float32Array, start: number, stride: number, n: number, r: number) {
  let sum = 0;
  let count = 0;
  const add = (k: number, sign: 1 | -1) => {
    const v = src[start + k * stride];
    if (!Number.isNaN(v)) {
      sum += sign * v;
      count += sign;
    }
  };
  for (let k = 0; k <= Math.min(r, n - 1); k++) add(k, 1);
  for (let k = 0; k < n; k++) {
    dst[start + k * stride] = count > 0 ? sum / count : NaN;
    if (k + r + 1 < n) add(k + r + 1, 1);
    if (k - r >= 0) add(k - r, -1);
  }
}

/** Keep every `step`-th point in each direction, starting at the south-west corner. */
export function thin(values: Float32Array, grid: HrrrGridInfo, step: number): HrrrMessage {
  if (step <= 1) return { data: values, grid };
  const ni = Math.floor((grid.ni - 1) / step) + 1;
  const nj = Math.floor((grid.nj - 1) / step) + 1;
  const out = new Float32Array(ni * nj);
  for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) out[j * ni + i] = values[j * step * grid.ni + i * step];
  return { data: out, grid: { ...grid, ni, nj, dx: grid.dx * step, dy: grid.dy * step } };
}

export function mapValues(values: Float32Array, fn: (v: number) => number): Float32Array {
  const out = new Float32Array(values.length);
  for (let k = 0; k < values.length; k++) out[k] = fn(values[k]);
  return out;
}

export function combine(a: Float32Array, b: Float32Array, fn: (a: number, b: number) => number): Float32Array {
  const out = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) out[k] = fn(a[k], b[k]);
  return out;
}

/** Wet-bulb temperature (deg C) from temperature and dewpoint (deg C), Stull (2011). */
export function wetBulbStull(tC: number, tdC: number): number {
  const es = (t: number) => 6.112 * Math.exp((17.67 * t) / (t + 243.5));
  const rh = Math.max(1, Math.min(100, (100 * es(tdC)) / es(tC)));
  return (
    tC * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(tC + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035
  );
}
