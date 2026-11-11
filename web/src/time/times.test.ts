import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/dataSources', () => ({ dataSources: { hrrrRoot: 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com' } }));

import { formatUtc, hrrrGribUrl, makeInit, maxForecastHour, normalizeInit, shiftInit, validDate } from './times';

describe('time helpers', () => {
  it('gives 48 h at synoptic hours and 18 h otherwise', () => {
    for (let h = 0; h < 24; h++) expect(maxForecastHour(h)).toBe([0, 6, 12, 18].includes(h) ? 48 : 18);
  });
  it('builds init strings and shifts across days', () => {
    expect(makeInit(2024, 4, 30, 0)).toBe('2024-04-30T00:00Z');
    expect(shiftInit('2024-04-30T00:00Z', -1)).toBe('2024-04-29T23:00Z');
    expect(normalizeInit('2024-04-30T12:00:00Z')).toBe('2024-04-30T12:00Z');
  });
  it('builds NOAA GRIB URLs', () => {
    expect(hrrrGribUrl('2024-04-30T06:00Z', 7)).toBe(
      'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20240430/conus/hrrr.t06z.wrfsfcf07.grib2',
    );
  });
  it('formats valid times in UTC', () => {
    expect(formatUtc(validDate('2024-04-30T23:00Z', 3))).toBe('Wed 2024-05-01 02:00 UTC');
  });
});
