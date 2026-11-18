import { describe, expect, it, vi } from 'vitest';

vi.mock('../data/soundings', () => ({ SoundingUnavailable: class extends Error {}, readSounding: vi.fn() }));
vi.mock('../model/ptypeModel', () => ({ predict: vi.fn() }));

import { parseManifest } from '../data/manifest';
import { SoundingUnavailable } from '../data/soundings';
import type { Profile } from './profile';
import { trendFrames } from '../time/trend';
import { loadTrendSeries } from './trendSeries';

describe('loadTrendSeries', () => {
  const frames = trendFrames('2023-12-26T03:00Z', new Date('2030-01-01T00:00Z')).filter((f) => f.fhour <= 3);
  const manifest = parseManifest({
    inits: [
      { init: '2023-12-26T00:00Z', forecast_hours: [0, 1, 2, 3] },
      { init: '2023-12-26T01:00Z', forecast_hours: [0, 1] }, // does not reach the valid time
      { init: '2023-12-26T02:00Z', forecast_hours: [0, 1] }, // sounding missing at the point
    ],
  });

  it('gives a value per run, with null where there is no forecast, and reads at most four at once', async () => {
    let active = 0;
    let most = 0;
    const read = vi.fn(async (entry: { init: string }, fhour: number) => {
      most = Math.max(most, ++active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      if (entry.init === '2023-12-26T02:00Z') throw new SoundingUnavailable('none');
      return { lon: 0, lat: 0, profile: { t: [fhour] } as unknown as Profile };
    });
    const run = vi.fn(async (p: Profile) => ({ probs: [p.t[0], 0, 0, 0], u: 0.5 }));
    const got = new Map<number, unknown>();
    await loadTrendSeries(frames, manifest, -90, 40, (f, v) => got.set(f.fhour, v), () => false, read as never, run);
    expect(frames.map((f) => f.fhour)).toEqual([3, 2, 1, 0]);
    expect(got.get(3)).toEqual({ probs: [3, 0, 0, 0], u: 0.5 });
    expect(got.get(2)).toBeNull(); // run 01Z has no hour 2
    expect(got.get(1)).toBeNull(); // sounding unavailable
    expect(got.get(0)).toBeNull(); // run 03Z is not in the index
    expect(read).toHaveBeenCalledTimes(2);
    expect(most).toBeLessThanOrEqual(4);
  });

  it('stops when cancelled', async () => {
    const read = vi.fn(async () => ({ lon: 0, lat: 0, profile: {} as Profile }));
    const got: number[] = [];
    await loadTrendSeries(frames, manifest, -90, 40, (f) => got.push(f.fhour), () => true, read as never, async () => ({ probs: [], u: 0 }));
    expect(got).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
