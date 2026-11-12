import { describe, expect, it } from 'vitest';
import fixtures from '../testdata/fixtures.json';
import { Lambert, cellLonLat, nearestCell, parseProj4Lambert, type GridDef } from './lambert';

const g = fixtures.grid;
const grid: GridDef = {
  ni: g.ni, nj: g.nj, dx: g.dx, dy: g.dy, llX: g.ll_x, llY: g.ll_y,
  lon0: g.lon_0, lat0: g.lat_0, latStd: g.lat_std as [number, number], radius: g.earth_radius,
};

describe('Lambert grid lookup', () => {
  it('finds the HRRR grid cell for lat/lon pairs from the sample file', () => {
    for (const p of fixtures.points) {
      const cell = nearestCell(grid, p.lon, p.lat);
      expect(cell).toEqual({ i: p.i, j: p.j, index: p.j * grid.ni + p.i });
    }
  });

  it('round-trips cell centres', () => {
    for (const p of fixtures.points) {
      const [lon, lat] = cellLonLat(grid, p.i, p.j);
      expect(lon).toBeCloseTo(p.lon, 2);
      expect(lat).toBeCloseTo(p.lat, 2);
    }
  });

  it('returns null outside the grid', () => {
    expect(nearestCell(grid, -70, 45)).toBeNull();
  });

  it('parses a PROJ string and matches the south-west corner', () => {
    const params = parseProj4Lambert('+proj=lcc +lat_1=38.5 +lat_2=38.5 +lat_0=38.5 +lon_0=-97.5 +R=6371229.0 +units=m +no_defs +type=crs');
    const [x, y] = new Lambert(params).forward(g.ll_lon, g.ll_lat);
    expect(Math.abs(x - g.ll_x)).toBeLessThan(50);
    expect(Math.abs(y - g.ll_y)).toBeLessThan(50);
  });
});
