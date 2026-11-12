/**
 * Melting/refreezing layer statistics for a temperature profile.
 * Port of calc_sounding_stats in backend/app.py.
 */

export interface SoundingStats {
  /** Refreezing energy, J/kg (magnitude of the negative areas). */
  coldArea: number;
  /** Melting energy, J/kg. */
  warmArea: number;
  coldThickness: number;
  warmThickness: number;
  minCold: number;
  maxWarm: number;
  highestCrossing: number;
  lowestCrossing: number;
  surfaceTemp: number;
}

const FREEZING_K = 273.15;
const GRAVITY = 9.81;

/** Insert an exact 0 degC point wherever the profile changes sign. */
export function addZeroCrossings(profile: number[], heights: number[]) {
  const p: number[] = [];
  const h: number[] = [];
  for (let k = 0; k < profile.length; k++) {
    p.push(profile[k]);
    h.push(heights[k]);
    if (k < profile.length - 1 && Math.sign(profile[k]) !== Math.sign(profile[k + 1])) {
      const a = profile[k];
      const b = profile[k + 1];
      // Linear interpolation of height at T = 0 (matches np.interp, including its clamping).
      const frac = a === b ? 0 : Math.min(1, Math.max(0, (0 - a) / (b - a)));
      p.push(0);
      h.push(heights[k] + frac * (heights[k + 1] - heights[k]));
    }
  }
  return { profile: p, heights: h };
}

function trapezoid(y: number[], x: number[], lo: number, hi: number): number {
  let s = 0;
  for (let k = lo; k < hi; k++) s += 0.5 * (y[k] + y[k + 1]) * (x[k + 1] - x[k]);
  return s;
}

export function soundingStats(tempC: number[], heightsM: number[]): SoundingStats {
  const surfaceTemp = tempC[0];
  const { profile, heights } = addZeroCrossings(tempC, heightsM);
  const zeros = profile.map((v, k) => (v === 0 ? k : -1)).filter((k) => k >= 0);
  if (zeros.length === 0) {
    return {
      coldArea: 0, warmArea: 0, coldThickness: 0, warmThickness: 0,
      minCold: NaN, maxWarm: NaN, highestCrossing: NaN, lowestCrossing: NaN, surfaceTemp,
    };
  }
  const upper = zeros[zeros.length - 1] + 1;
  const below = profile.slice(0, upper);
  let cold = 0, warm = 0, coldThickness = 0, warmThickness = 0, low = 0;
  const energy = profile.map((t) => (GRAVITY * t) / FREEZING_K);
  for (let k = 0; k < upper; k++) {
    if (profile[k] !== 0) continue;
    const e = trapezoid(energy, heights, low, k);
    if (e <= 0) {
      cold += e;
      coldThickness += heights[k] - heights[low];
    } else {
      warm += e;
      warmThickness += heights[k] - heights[low];
    }
    low = k;
  }
  return {
    coldArea: Math.trunc(Math.abs(cold)),
    warmArea: Math.trunc(warm),
    coldThickness: Math.trunc(coldThickness),
    warmThickness: Math.trunc(warmThickness),
    minCold: Math.min(...below),
    maxWarm: Math.max(...below),
    highestCrossing: heights[upper - 1],
    lowestCrossing: heights[zeros[0]],
    surfaceTemp,
  };
}
