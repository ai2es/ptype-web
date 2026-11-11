/** Turns a ptype frame into the single raster field drawn on the map. */
import { ColorMap } from '../vendor/apgl';
import { PTYPE_STYLES } from '../config/ptypeStyle';
import { PTYPE_CLASSES, type PtypeFrame } from '../data/ptype';
import type { HrrrMessage } from '../data/hrrr';
import { Lambert, type GridDef } from '../geo/lambert';

/**
 * The map shows the most likely type at each point, shaded by its probability.
 * That is encoded as `classIndex + probability`, so one colour map covers all
 * four types: [0,1) rain, [1,2) snow, [2,3) sleet, [3,4) freezing rain.
 */
export const PTYPE_CMAP = (() => {
  const levels: number[] = [];
  const colors: string[] = [];
  PTYPE_STYLES.forEach((style, c) => {
    style.ramp.forEach((color, k) => {
      levels.push(c + k / 10);
      colors.push(color);
    });
  });
  levels.push(PTYPE_STYLES.length);
  return new ColorMap(levels, colors);
})();

const HIDDEN = -1;

export function dominantField(frame: PtypeFrame, mask: Uint8Array | null): Float32Array {
  const n = frame.u.length;
  const out = new Float32Array(n);
  const arrays = PTYPE_CLASSES.map((c) => frame.probs[c]);
  for (let k = 0; k < n; k++) {
    if (mask && !mask[k]) {
      out[k] = HIDDEN;
      continue;
    }
    let best = 0;
    let bestP = arrays[0][k];
    for (let c = 1; c < arrays.length; c++) {
      if (arrays[c][k] > bestP) {
        bestP = arrays[c][k];
        best = c;
      }
    }
    out[k] = Number.isNaN(bestP) ? HIDDEN : best + Math.min(Math.max(bestP, 0), 0.9999);
  }
  return out;
}

/**
 * Mask of ptype-grid cells where the HRRR reports any precipitation type.
 * `precip` holds the HRRR categorical fields (CRAIN, CSNOW, CICEP, CFRZR) on
 * the native 3 km grid; coarser pyramid cells are set if any 3 km cell inside
 * them has precipitation.
 */
export function precipMask(grid: GridDef, precip: HrrrMessage[]): Uint8Array {
  const h = precip[0].grid;
  const proj = new Lambert(grid);
  const [hx0, hy0] = proj.forward(h.llLon, h.llLat);
  const fx = Math.max(1, Math.round(grid.dx / h.dx));
  const fy = Math.max(1, Math.round(grid.dy / h.dy));
  const mask = new Uint8Array(grid.ni * grid.nj);
  for (let j = 0; j < grid.nj; j++) {
    const j0 = Math.round((grid.llY + j * grid.dy - grid.dy / 2 + h.dy / 2 - hy0) / h.dy);
    for (let i = 0; i < grid.ni; i++) {
      const i0 = Math.round((grid.llX + i * grid.dx - grid.dx / 2 + h.dx / 2 - hx0) / h.dx);
      let any = 0;
      for (let dj = 0; dj < fy && !any; dj++) {
        const jj = j0 + dj;
        if (jj < 0 || jj >= h.nj) continue;
        for (let di = 0; di < fx; di++) {
          const ii = i0 + di;
          if (ii < 0 || ii >= h.ni) continue;
          const idx = jj * h.ni + ii;
          if (precip.some((m) => m.data[idx] > 0.5)) {
            any = 1;
            break;
          }
        }
      }
      mask[j * grid.ni + i] = any;
    }
  }
  return mask;
}
