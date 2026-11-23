import { describe, expect, it } from 'vitest';
import { hourlySnowfallInches, splitContourLevels } from './gridops';

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

describe('hourly snowfall', () => {
  it('is the growth of the run total, in inches', () => {
    const out = hourlySnowfallInches(Float32Array.from([0.0508, 0.0254, 0]), Float32Array.from([0.0254, 0.0254, 0]));
    expect(out[0]).toBeCloseTo(1, 3);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('never goes negative when the two files round differently', () => {
    expect(hourlySnowfallInches(Float32Array.from([0.0100]), Float32Array.from([0.0101]))[0]).toBe(0);
  });

  it('is zero everywhere at the analysis, which has no hour before it', () => {
    expect([...hourlySnowfallInches(Float32Array.from([0, 0.2]), null)]).toEqual([0, 0]);
  });
});
