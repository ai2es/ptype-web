import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ort from 'onnxruntime-web';
import fixtures from './fixtures.json';
import { denseForward } from './denseNet';
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

describe('evidential model in plain JavaScript (fallback)', () => {
  it('reproduces the Keras probabilities and uncertainty', () => {
    const bytes = readFileSync('public/model/ptype_model_weights.bin');
    const weights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const net = { layers: meta.dense_layers!, alpha: meta.leaky_relu_alpha!, weights };
    let maxErr = 0;
    for (let n = 0; n < fixtures.inputs.length; n++) {
      const pred = dirichlet(denseForward(net, buildInput(toProfile(fixtures.inputs[n]), meta)));
      pred.probs.forEach((p, k) => (maxErr = Math.max(maxErr, Math.abs(p - fixtures.prob[n][k]))));
      maxErr = Math.max(maxErr, Math.abs(pred.u - fixtures.u[n]));
    }
    expect(maxErr).toBeLessThan(1e-4);
  });

  it('rejects weights that do not match the layer sizes', () => {
    expect(() => denseForward({ layers: [[2, 1]], alpha: 0.2, weights: new Float32Array(2) }, [1, 2])).toThrow(/do not match/);
  });
});
