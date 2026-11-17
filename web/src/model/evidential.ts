/** Pure maths around the evidential network: input scaling and Dirichlet outputs. */
import type { Profile } from '../sounding/profile';

export interface ModelMeta {
  classes: string[];
  heights_m: number[];
  input_groups: string[];
  scaler: { center: number[]; scale: number[] };
}

export interface Prediction {
  /** Class probabilities in model order (rain, snow, icep, frzr). */
  probs: number[];
  /** Evidential uncertainty u = K / S (0 = confident, 1 = no evidence). */
  u: number;
}

/**
 * Winds as the network expects them: relative to the HRRR grid. Stored
 * soundings hold earth-relative winds (so the hodograph and barbs are true),
 * with u_earth = cos(a) u_grid + sin(a) v_grid and v_earth = -sin(a) u_grid +
 * cos(a) v_grid; this applies the inverse rotation.
 */
export function gridRelativeWind(profile: Profile): [number[], number[]] {
  const a = profile.gridAngle;
  if (!a) return [profile.u, profile.v];
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [profile.u.map((ue, k) => c * ue - s * profile.v[k]), profile.u.map((ue, k) => s * ue + c * profile.v[k])];
}

/** Build the scaled input vector: T, Td, U, V, each surface to top. */
export function buildInput(profile: Profile, meta: ModelMeta): Float32Array {
  const [u, v] = gridRelativeWind(profile);
  const groups = [profile.t, profile.td, u, v];
  const nLev = meta.heights_m.length;
  const out = new Float32Array(groups.length * nLev);
  groups.forEach((values, g) => {
    if (values.length !== nLev) throw new Error(`Expected ${nLev} levels, got ${values.length}`);
    for (let k = 0; k < nLev; k++) out[g * nLev + k] = (values[k] - meta.scaler.center[g]) / meta.scaler.scale[g];
  });
  return out;
}

/** Evidential (Dirichlet) post-processing, as in mlguess CategoricalDNN. */
export function dirichlet(logits: ArrayLike<number>): Prediction {
  const alpha = Array.from(logits, (y) => Math.max(y, 0) + 1);
  const s = alpha.reduce((a, b) => a + b, 0);
  return { probs: alpha.map((a) => a / s), u: alpha.length / s };
}
