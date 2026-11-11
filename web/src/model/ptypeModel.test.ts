import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import fixtures from './fixtures.json';
import { buildInput, dirichlet, type ModelMeta } from './evidential';

const meta = JSON.parse(readFileSync('public/model/ptype_model.json', 'utf8')) as ModelMeta;
const nLev = meta.heights_m.length;

function toProfile(row: number[]) {
  const g = (k: number) => row.slice(k * nLev, (k + 1) * nLev);
  return { heights: meta.heights_m, t: g(0), td: g(1), u: g(2), v: g(3), p: [] };
}

describe('evidential model in ONNX Runtime Web', () => {
  it('reproduces the Keras probabilities and uncertainty', async () => {
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(readFileSync('public/model/ptype_model.onnx'));
    let maxErr = 0;
    for (let n = 0; n < fixtures.inputs.length; n++) {
      const x = new ort.Tensor('float32', buildInput(toProfile(fixtures.inputs[n]), meta), [1, 4 * nLev]);
      const out = await session.run({ input: x });
      const pred = dirichlet(out.output.data as Float32Array);
      pred.probs.forEach((p, k) => (maxErr = Math.max(maxErr, Math.abs(p - fixtures.prob[n][k]))));
      maxErr = Math.max(maxErr, Math.abs(pred.u - fixtures.u[n]));
      expect(pred.probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
    expect(maxErr).toBeLessThan(1e-4);
  });
});
