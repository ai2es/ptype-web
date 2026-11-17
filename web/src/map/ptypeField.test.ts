import { Float16Array } from '@petamoriken/float16';
import { describe, expect, it, vi } from 'vitest';
import type { PtypeFrame } from '../data/ptype';

// ptypeField builds a colour map with autumnplot-gl, which only exists in the browser bundle.
vi.mock('../vendor/apgl', () => ({ ColorMap: class {} }));

import { dominantField } from './ptypeField';

describe('dominant precipitation type as drawn', () => {
  it('keeps each class in its own colour band after 16-bit rounding', () => {
    // One cell per class, each with a probability of exactly 1.
    const one = (k: number) => Float32Array.from([0, 1, 2, 3].map((c) => (c === k ? 1 : 0)));
    const frame = { probs: { rain: one(0), snow: one(1), icep: one(2), frzr: one(3) }, u: new Float32Array(4) } as unknown as PtypeFrame;
    const drawn = new Float16Array(dominantField(frame, null));
    for (let k = 0; k < 4; k++) {
      expect(Math.floor(drawn[k])).toBe(k);
      expect(drawn[k] - k).toBeGreaterThan(0.98);
    }
  });

  it('hides cells where no type has any probability, as Bourgouin can give', () => {
    const zero = Float32Array.from([0, 0.4]);
    const frame = { probs: { rain: zero, snow: Float32Array.from([0, 0.7]), icep: zero, frzr: zero }, u: new Float32Array(0) } as unknown as PtypeFrame;
    const drawn = dominantField(frame, null);
    expect(drawn[0]).toBe(-1);
    expect(drawn[1]).toBeCloseTo(1.7, 5);
  });

  it('hides masked cells', () => {
    const p = Float32Array.from([0.9]);
    const frame = { probs: { rain: p, snow: p, icep: p, frzr: p }, u: new Float32Array(1) } as unknown as PtypeFrame;
    expect(new Float16Array(dominantField(frame, Uint8Array.from([0])))[0]).toBe(-1);
  });
});
