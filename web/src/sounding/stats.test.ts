import { describe, expect, it } from 'vitest';
import fixtures from '../testdata/fixtures.json';
import { soundingStats } from './stats';

const close = (actual: number, expected: number | null, tol: number) => {
  if (expected === null) expect(actual).toBeNaN();
  else expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

describe('soundingStats', () => {
  it('matches calc_sounding_stats from the Flask backend', () => {
    for (const { t, expected: e } of fixtures.stats) {
      const s = soundingStats(t, fixtures.heights);
      close(s.coldArea, e.cold_area, 1);
      close(s.warmArea, e.warm_area, 1);
      close(s.coldThickness, e.cold_thickness, 1);
      close(s.warmThickness, e.warm_thickness, 1);
      close(s.minCold, e.min_cold, 1e-3);
      close(s.maxWarm, e.max_warm, 1e-3);
      close(s.highestCrossing, e.highest_crossing, 1e-2);
      close(s.lowestCrossing, e.lowest_crossing, 1e-2);
      close(s.surfaceTemp, e.surface_temp, 1e-3);
    }
  });
});
