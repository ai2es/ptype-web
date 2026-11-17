import { describe, expect, it, vi } from 'vitest';
import type { HrrrMessage } from '../data/hrrr';
import type { PtypeLevel } from '../data/ptype';
import { Lambert } from '../geo/lambert';

// ptypeField builds a colour map with autumnplot-gl, which only exists in the browser bundle.
vi.mock('../vendor/apgl', () => ({ ColorMap: class {} }));

import { maskCacheStats, maskFromReflectivity, reflectivityMask, releaseMasksExcept } from './reflectivityMask';

/** A small Lambert grid and a reflectivity message on the same cells, or on cells `factor` times finer. */
function setup(ni: number, nj: number, factor: number, dbz: number[]) {
  const base = { lon0: -97.5, lat0: 38.5, latStd: [38.5, 38.5] as [number, number], radius: 6371229 };
  const dx = 3000 * factor;
  // Coarse cell centres sit in the middle of their block of fine cells, as in the store's pyramid.
  const grid = { ...base, ni, nj, dx, dy: dx, llX: -30000 + (dx - 3000) / 2, llY: -30000 + (dx - 3000) / 2 };
  const [llLon, llLat] = new Lambert(base).inverse(-30000, -30000);
  const refc: HrrrMessage = {
    data: Float32Array.from(dbz),
    grid: { ni: ni * factor, nj: nj * factor, lon0: -97.5, lat0: 38.5, latStd: [38.5, 38.5], llLon, llLat, dx: 3000, dy: 3000 },
  };
  const level: PtypeLevel = { path: '0', grid, flipRows: false };
  return { level, refc };
}

describe('maskFromReflectivity', () => {
  it('keeps cells above 0 dBZ and drops no-echo, zero and missing cells', () => {
    const { level, refc } = setup(3, 2, 1, [-10, 0, 0.5, 35, NaN, -0.1]);
    expect(Array.from(maskFromReflectivity(level, refc))).toEqual([0, 0, 1, 1, 0, 0]);
  });

  it('sets a coarse cell when any fine cell inside it has an echo', () => {
    // 4 x 2 fine cells -> 2 x 1 coarse cells; only the right-hand block has an echo.
    const { level, refc } = setup(2, 1, 2, [-10, -10, -10, -10, -10, -10, -10, 20]);
    expect(Array.from(maskFromReflectivity(level, refc))).toEqual([0, 1]);
  });
});

describe('releaseMasksExcept', () => {
  it('keeps only the selected run', async () => {
    const { level, refc } = setup(3, 2, 1, [-10, 0, 0.5, 35, NaN, -0.1]);
    const fetch = () => Promise.resolve(refc);
    await reflectivityMask('2023-12-26T00:00Z', 1, level, fetch);
    await reflectivityMask('2023-12-26T00:00Z', 2, level, fetch);
    await reflectivityMask('2023-12-26T06:00Z', 1, level, fetch);
    expect(maskCacheStats()).toMatchObject({ masks: 3, runs: 2 });
    releaseMasksExcept('2023-12-26T06:00Z');
    expect(maskCacheStats()).toMatchObject({ masks: 1, runs: 1 });
  });
});
