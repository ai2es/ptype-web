/**
 * Kept apart from ptypeField.ts so that file stays free of drawing classes: its tests replace the drawing
 * library with a stub that has only a colour map.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { Raster, type LambertGrid } from '../vendor/apgl';

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
