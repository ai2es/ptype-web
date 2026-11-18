/**
 * Terrain basemap: hill shading and elevation contours, both from one set of elevation tiles.
 *
 * Nothing here loads until the terrain basemap is first chosen: the contour library (which starts a web
 * worker) is imported on demand, so the plain basemap costs what it did before.
 *
 * Where the layers sit, and why:
 *   - shading goes under the water and under every weather fill, so it never tints a colour that has a legend;
 *   - contour lines and their labels go above the weather fills (below the boundaries), so the terrain can
 *     still be read where an opaque field such as temperature covers the shading.
 */
import type * as maplibregl from 'maplibre-gl';
import { ANCHOR_LINES } from './style';

export type Basemap = 'plain' | 'terrain';

/** Mapzen "terrarium" elevation tiles, published as AWS open data; no key, cross-origin reads allowed. */
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const DEM_ATTRIBUTION =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Mapzen terrain tiles</a> (USGS 3DEP, SRTM, GMTED2010, ETOPO1)';
/** The map stops at zoom 10, so finer elevation tiles would never be drawn at their own resolution. */
const DEM_MAX_ZOOM = 10;
const FEET_PER_METRE = 3.28084;

/**
 * Contour spacing in feet as [minor, major] from each zoom upward. Chosen so neighbouring lines stay a few
 * pixels apart on the steepest ranges at that zoom; majors are drawn heavier and labelled.
 */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  3: [5000, 10000],
  5: [2000, 10000],
  6: [1000, 5000],
  8: [500, 2500],
  9: [200, 1000],
};

export const TERRAIN_LAYERS = ['terrain-shade', 'terrain-contours', 'terrain-contour-labels'];

let demSource: Promise<{ contourUrl: string; demUrl: string }> | null = null;

/** Register the contour protocol with MapLibre once, however many times the basemap is switched. */
function setupDem(lib: typeof maplibregl) {
  demSource ??= import('maplibre-contour').then(({ default: mlcontour }) => {
    const source = new mlcontour.DemSource({ url: DEM_TILES, encoding: 'terrarium', maxzoom: DEM_MAX_ZOOM, worker: true, cacheSize: 100 });
    source.setupMaplibre(lib);
    return {
      contourUrl: source.contourProtocolUrl({ multiplier: FEET_PER_METRE, thresholds: CONTOUR_THRESHOLDS, contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level' }),
      // The shading reads the same cached tiles the contours are made from, so each is fetched once.
      demUrl: source.sharedDemProtocolUrl,
    };
  });
  return demSource;
}

async function addTerrain(lib: typeof maplibregl, map: maplibregl.Map): Promise<void> {
  const { contourUrl, demUrl } = await setupDem(lib);
  if (map.getSource('terrain-dem')) return;
  map.addSource('terrain-dem', { type: 'raster-dem', encoding: 'terrarium', tiles: [demUrl], maxzoom: DEM_MAX_ZOOM, tileSize: 256, attribution: DEM_ATTRIBUTION });
  map.addSource('terrain-contours', { type: 'vector', tiles: [contourUrl], maxzoom: DEM_MAX_ZOOM });
  map.addLayer(
    {
      id: 'terrain-shade', type: 'hillshade', source: 'terrain-dem',
      paint: { 'hillshade-exaggeration': 0.55, 'hillshade-shadow-color': '#5b5246', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#6b6255' },
    },
    'water',
  );
  map.addLayer(
    {
      id: 'terrain-contours', type: 'line', source: 'terrain-contours', 'source-layer': 'contours',
      paint: { 'line-color': '#6f4e2c', 'line-opacity': ['match', ['get', 'level'], 1, 0.8, 0.55], 'line-width': ['match', ['get', 'level'], 1, 1.1, 0.6] },
    },
    'counties',
  );
  map.addLayer(
    {
      id: 'terrain-contour-labels', type: 'symbol', source: 'terrain-contours', 'source-layer': 'contours', minzoom: 6,
      filter: ['>', ['get', 'level'], 0],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 400, 'text-size': 10, 'text-font': ['Noto Sans Regular'],
        'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' ft'],
      },
      paint: { 'text-color': '#5a3d1e', 'text-halo-color': 'rgba(255,255,255,0.85)', 'text-halo-width': 1.2 },
    },
    ANCHOR_LINES,
  );
}

/** Show or hide the terrain layers, creating them the first time they are wanted. */
export async function setBasemap(lib: typeof maplibregl, map: maplibregl.Map, basemap: Basemap): Promise<void> {
  if (basemap === 'terrain') await addTerrain(lib, map);
  for (const id of TERRAIN_LAYERS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', basemap === 'terrain' ? 'visible' : 'none');
  }
}
