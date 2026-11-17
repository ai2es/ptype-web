import { describe, expect, it } from 'vitest';
import { gridAngle } from '../data/soundings';
import { gridRelativeWind } from './evidential';

const profile = (u: number[], v: number[], angle?: number) => ({ heights: [0, 250], t: [0, 0], td: [0, 0], u, v, p: [], gridAngle: angle });

describe('wind rotation for the network', () => {
  it('leaves grid-relative winds alone', () => {
    const p = profile([3, -2], [4, 5]);
    expect(gridRelativeWind(p)).toEqual([p.u, p.v]);
  });

  it('inverts the earth-relative rotation used when the soundings were written', () => {
    // The pipeline stores u_e = cos(a) u_g + sin(a) v_g, v_e = -sin(a) u_g + cos(a) v_g.
    const a = gridAngle(-75, -97.5, 38.5);
    const ug = [3, -2];
    const vg = [4, 5];
    const ue = ug.map((u, k) => Math.cos(a) * u + Math.sin(a) * vg[k]);
    const ve = ug.map((u, k) => -Math.sin(a) * u + Math.cos(a) * vg[k]);
    const [u, v] = gridRelativeWind(profile(ue, ve, a));
    u.forEach((x, k) => expect(x).toBeCloseTo(ug[k], 10));
    v.forEach((x, k) => expect(x).toBeCloseTo(vg[k], 10));
  });

  it('has the HRRR sign convention and cone constant', () => {
    expect(gridAngle(-97.5, -97.5, 38.5)).toBe(0);
    // East of the central meridian grid north points east of true north (alpha > 0).
    expect(gridAngle(-75, -97.5, 38.5)).toBeCloseTo(0.6225146366376195 * ((22.5 * Math.PI) / 180), 12);
    expect(gridAngle(-120, -97.5, 38.5)).toBeLessThan(0);
    // Longitudes may arrive as 0-360.
    expect(gridAngle(285, -97.5, 38.5)).toBeCloseTo(gridAngle(-75, -97.5, 38.5), 12);
  });
});
