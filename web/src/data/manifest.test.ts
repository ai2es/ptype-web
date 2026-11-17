import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/dataSources', () => ({ dataSources: { ptypeRoot: 'https://b.example/ptype', soundingRoot: 'https://b.example' } }));

import { parseManifest, soundingUrl, storeUrl } from './manifest';

describe('forecast index', () => {
  it('resolves the gridded and sounding stores of a run as the pipeline writes them', () => {
    const m = parseManifest({
      inits: [
        {
          init: '2023-12-26T00:00Z',
          forecast_hours: [2, 0, 1],
          store: '2023/12/26/hrrr_ptype_20231226_0000.zarr',
          soundings: 'soundings/2023/12/26/hrrr_soundings_20231226_0000.zarr',
        },
      ],
    });
    const entry = [...m.values()][0];
    expect(entry.forecastHours).toEqual([0, 1, 2]);
    expect(storeUrl(entry)).toBe('https://b.example/ptype/2023/12/26/hrrr_ptype_20231226_0000.zarr');
    expect(soundingUrl(entry)).toBe('https://b.example/soundings/2023/12/26/hrrr_soundings_20231226_0000.zarr');
  });

  it('falls back to the conventional paths when the index omits them', () => {
    const entry = [...parseManifest({ inits: [{ init: '2023-12-26T06:00Z' }] }).values()][0];
    expect(entry.store).toBe('2023/12/26/hrrr_ptype_20231226_0600.zarr');
    expect(entry.soundings).toBe('soundings/2023/12/26/hrrr_soundings_20231226_0600.zarr');
  });
});
