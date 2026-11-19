/** Turns a ptype frame into the single raster field drawn on the map. */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { ColorMap, Raster, type LambertGrid } from '../vendor/apgl';
import { PTYPE_STYLES } from '../config/ptypeStyle';
import { PTYPE_CLASSES, probability, type PtypeFrame } from '../data/ptype';
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

/**
 * A raster that draws each colour of its colour map as a flat bin.
 *
 * autumnplot-gl's Raster blends neighbouring colours of the map, which is right for a continuous field and wrong
 * for this one, whose colour map is four ramps end to end. A probability above 0.95 sits past the centre of its
 * type's last colour, so it was blended towards the first (palest) colour of the next type: rain at 0.99 was drawn
 * as 60% darkest green and 40% palest snow blue, lighter than rain at 0.9 (measured: rgb 96,148,121 where the
 * ramp says 0,83,33). Flat bins also make the map match the legend's swatches exactly.
 *
 * The library sets the filter inside `onAdd` with no option for it, so the property is pinned here instead.
 */
export class BinnedRaster extends Raster<Float16Array, LambertGrid, MapLibreMap> {
  async onAdd(map: MapLibreMap, gl: WebGL2RenderingContext): Promise<void> {
    Object.defineProperty(this, 'cmap_mag_filter', { get: () => gl.NEAREST, set: () => {}, configurable: true });
    await super.onAdd(map, gl);
  }
}

const HIDDEN = -1;
export const MAX_FRACTION = 0.99;

export function dominantField(frame: PtypeFrame, mask: Uint8Array | null): Float32Array {
  const n = frame.probs.rain.length;
  const out = new Float32Array(n);
  const arrays = PTYPE_CLASSES.map((c) => frame.probs[c]);
  for (let k = 0; k < n; k++) {
    if (mask && !mask[k]) {
      out[k] = HIDDEN;
      continue;
    }
    let best = 0;
    let bestCode = arrays[0][k];
    for (let c = 1; c < arrays.length; c++) {
      if (arrays[c][k] > bestCode) {
        bestCode = arrays[c][k];
        best = c;
      }
    }
    // Missing is the largest code, so a cell with any missing class ends up missing.
    const bestP = probability(bestCode);
    // The value is class + probability. It is stored as a 16-bit float for drawing, whose steps near 4 are
    // 1/512, so the probability is capped where rounding cannot carry it into the next class.
    // No type has any probability: possible for Bourgouin (its probabilities are independent), never for the network.
    out[k] = Number.isNaN(bestP) || bestP <= 0 ? HIDDEN : best + Math.min(Math.max(bestP, 0), MAX_FRACTION);
  }
  return out;
}

/**
 * Mask of ptype-grid cells where any of `fields` exceeds `threshold`.
 * `fields` are HRRR messages on the native 3 km grid: composite reflectivity
 * (threshold 0 dBZ) or, for the older fallback, the categorical types CRAIN,
 * CSNOW, CICEP and CFRZR (threshold 0.5). Coarser pyramid cells are set if
 * any 3 km cell inside them qualifies.
 */
export function precipMask(grid: GridDef, precip: HrrrMessage[], threshold = 0.5): Uint8Array {
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
          if (precip.some((m) => m.data[idx] > threshold)) {
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
