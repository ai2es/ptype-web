import { describe, expect, it } from 'vitest';
import { splitContourLevels } from './gridops';

describe('contour levels by zoom', () => {
  it('puts multiples of the coarse interval in one set and the rest in the other', () => {
    const s = splitContourLevels(Float32Array.from([-5.5, 9.2, 3]), 2, 4);
    expect(s.coarse).toEqual([-4, 0, 4, 8]);
    expect(s.fine).toEqual([-2, 2, 6]);
  });

  it('includes a level that the data just reaches and ignores NaN', () => {
    const s = splitContourLevels(Float32Array.from([NaN, 4, 8]), 2, 4);
    expect(s.coarse).toEqual([4, 8]);
    expect(s.fine).toEqual([6]);
  });

  it('returns nothing for a field with no finite values', () => {
    expect(splitContourLevels(Float32Array.from([NaN, NaN]), 2, 4)).toEqual({ coarse: [], fine: [] });
  });
});
