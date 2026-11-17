import { describe, expect, it } from 'vitest';
import type { HrrrMessage } from './hrrr';
import { prefetchOrder, startPrefetch, stopPrefetch, type PrefetchProgress } from './prefetch';

const msg = {} as HrrrMessage;

function run(opts: { hours: number[]; budget: number; searches: string[]; fail?: number[]; full?: number }) {
  const fetched: string[] = [];
  return new Promise<{ last: PrefetchProgress; fetched: string[]; maxParallel: number }>((resolve) => {
    let parallel = 0;
    let maxParallel = 0;
    startPrefetch(
      {
        key: 'k',
        hours: opts.hours,
        messageBudget: opts.budget,
        fetchMessage: async (fh, search) => {
          fetched.push(`${fh}|${search}`);
          return msg;
        },
        loadHour: async (fh, fetch) => {
          maxParallel = Math.max(maxParallel, ++parallel);
          await Promise.all(opts.searches.map(fetch));
          await new Promise((r) => setTimeout(r, 1));
          parallel--;
          if (opts.fail?.includes(fh)) throw new Error('missing');
          return fh !== opts.full;
        },
      },
      (p) => {
        if (!p.active) resolve({ last: p, fetched, maxParallel });
      },
    );
  });
}

describe('background loading of a run', () => {
  it('orders hours from just after the current one, wrapping round', () => {
    expect(prefetchOrder(3, [0, 1, 2, 3, 4, 5])).toEqual([4, 5, 0, 1, 2]);
    expect(prefetchOrder(5, [5, 0, 2])).toEqual([0, 2]);
  });

  it('loads every hour, two at a time, and reports failures separately', async () => {
    const { last, maxParallel } = await run({ hours: [1, 2, 3, 4, 5], budget: 100, searches: ['a', 'b'], fail: [3] });
    expect([...last.ready].sort()).toEqual([1, 2, 4, 5]);
    expect(last.failed).toEqual([3]);
    expect(last.limited).toBe(false);
    expect(maxParallel).toBe(2);
  });

  it('stops before the message cache would overflow', async () => {
    // Two messages per hour and room for seven: three hours fit, a fourth would evict the first.
    const { last, fetched } = await run({ hours: [1, 2, 3, 4, 5, 6], budget: 7, searches: ['a', 'b'] });
    expect(last.limited).toBe(true);
    expect(fetched.length).toBeLessThanOrEqual(7);
    expect(last.ready.length).toBeGreaterThanOrEqual(2);
    expect(last.ready).not.toContain(6);
  });

  it('stops when an hour reports that a cache is full', async () => {
    const { last } = await run({ hours: [1, 2, 3, 4, 5, 6, 7, 8], budget: 100, searches: ['a'], full: 3 });
    expect(last.limited).toBe(true);
    expect(last.ready).not.toContain(3);
    expect(last.ready).not.toContain(8);
  });

  it('goes quiet when stopped or replaced', async () => {
    const seen: PrefetchProgress[] = [];
    startPrefetch(
      { key: 'old', hours: [1, 2, 3], messageBudget: 10, fetchMessage: async () => msg, loadHour: () => new Promise((r) => setTimeout(() => r(true), 5)) },
      (p) => seen.push(p),
    );
    stopPrefetch();
    await new Promise((r) => setTimeout(r, 30));
    expect(seen.every((p) => p.ready.length === 0)).toBe(true);
  });
});
