import { beforeEach, describe, expect, it } from 'vitest';
import { manifestKey, manifestsEqual, parseManifest, soundingsOnly, storeAndHour } from '../data/manifest';
import { refreshManifest } from './refresh';
import { useApp } from './store';

const index = (hours: number[], store = 'a.zarr') =>
  parseManifest({ inits: [{ init: '2023-12-26T00:00Z', forecast_hours: hours, store }, { init: '2023-12-26T01:00Z', forecast_hours: [0, 1] }] });

describe('manifestsEqual', () => {
  it('compares runs, hours and store paths', () => {
    expect(manifestsEqual(index([0, 1]), index([0, 1]))).toBe(true);
    expect(manifestsEqual(index([0, 1]), index([0, 1, 2]))).toBe(false);
    expect(manifestsEqual(index([0, 1]), index([0, 2]))).toBe(false);
    expect(manifestsEqual(index([0, 1]), index([0, 1], 'realtime-staging/a.zarr'))).toBe(false);
    expect(manifestsEqual(index([0]), parseManifest({ inits: [{ init: '2023-12-26T00:00Z', forecast_hours: [0], store: 'a.zarr' }] }))).toBe(false);
  });
});

describe('manifestKey', () => {
  const frame = [{ init: '2023-12-26T00:00Z', fhour: 1 }];
  it('changes only when the runs it is asked about change in the way it is asked about', () => {
    const before = index([0, 1]);
    // Another run gains an hour: nothing about this frame changes.
    const other = parseManifest({ inits: [{ init: '2023-12-26T00:00Z', forecast_hours: [0, 1], store: 'a.zarr' }, { init: '2023-12-26T01:00Z', forecast_hours: [0, 1, 2] }] });
    expect(manifestKey(other, frame, storeAndHour)).toBe(manifestKey(before, frame, storeAndHour));
    // This run gains an hour the frame is not showing: the gridded key is the same, and so is the sounding key.
    expect(manifestKey(index([0, 1, 2]), frame, storeAndHour)).toBe(manifestKey(before, frame, storeAndHour));
    expect(manifestKey(index([0, 1, 2]), frame, soundingsOnly)).toBe(manifestKey(before, frame, soundingsOnly));
    // The hour on screen arrives, or the store moves: the gridded key changes.
    expect(manifestKey(index([0]), frame, storeAndHour)).not.toBe(manifestKey(before, frame, storeAndHour));
    expect(manifestKey(index([0, 1], 'final.zarr'), frame, storeAndHour)).not.toBe(manifestKey(before, frame, storeAndHour));
    expect(manifestKey(null, frame, storeAndHour)).toBe('no-index');
    expect(manifestKey(before, [{ init: '2020-01-01T00:00Z', fhour: 0 }], storeAndHour)).toBe('-');
  });
});

describe('refreshManifest', () => {
  beforeEach(() => useApp.setState({ manifest: index([0, 1]), manifestError: null }));

  it('keeps the same index object when nothing changed', async () => {
    const before = useApp.getState().manifest;
    expect(await refreshManifest(async () => index([0, 1]))).toBe(false);
    expect(useApp.getState().manifest).toBe(before);
  });

  it('adopts an index with a new hour or a moved store', async () => {
    expect(await refreshManifest(async () => index([0, 1, 2]))).toBe(true);
    expect(useApp.getState().manifest?.get('2023-12-26T00:00Z')?.forecastHours).toEqual([0, 1, 2]);
    expect(await refreshManifest(async () => index([0, 1, 2], 'final.zarr'))).toBe(true);
    expect(useApp.getState().manifest?.get('2023-12-26T00:00Z')?.store).toBe('final.zarr');
  });

  it('leaves everything alone when the read fails', async () => {
    const before = useApp.getState().manifest;
    expect(await refreshManifest(async () => { throw new Error('offline'); })).toBe(false);
    expect(useApp.getState().manifest).toBe(before);
    expect(useApp.getState().manifestError).toBeNull();
  });

  it('recovers from a failed first load', async () => {
    useApp.setState({ manifest: null, manifestError: 'HTTP 503' });
    expect(await refreshManifest(async () => index([0]))).toBe(true);
    expect(useApp.getState().manifestError).toBeNull();
  });
});
