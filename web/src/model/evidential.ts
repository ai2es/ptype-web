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

/** Build the scaled input vector: T, Td, U, V, each surface to top. */
export function buildInput(profile: Profile, meta: ModelMeta): Float32Array {
  const groups = [profile.t, profile.td, profile.u, profile.v];
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
