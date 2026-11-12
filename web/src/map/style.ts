/** MapLibre style: a plain basemap from OpenFreeMap vector tiles plus boundary overlays. */
import type { StyleSpecification } from 'maplibre-gl';
import { siteUrl } from '../config/dataSources';
import type { BoundaryId } from '../state/store';

export const BASEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
export const LABEL_FONT = 'Noto Sans Regular';

/** Weather fills are inserted below this layer, contours and barbs below ANCHOR_LINES. */
export const ANCHOR_FILLS = 'anchor-fills';
export const ANCHOR_LINES = 'anchor-lines';

/** Style layer ids controlled by each overlay toggle. */
export const BOUNDARY_LAYERS: Record<BoundaryId, string[]> = {
  states: ['states'],
  counties: ['counties'],
  cwas: ['cwas', 'cwa-labels'],
  highways: ['highways-casing', 'highways'],
  cities: ['cities'],
};

export function buildStyle(): StyleSpecification {
  const anchor = (id: string) => ({ id, type: 'background' as const, paint: { 'background-opacity': 0 } });
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {
      basemap: { type: 'vector', url: BASEMAP_TILEJSON, attribution: '© OpenStreetMap contributors, OpenMapTiles, OpenFreeMap' },
      counties: { type: 'geojson', data: siteUrl('overlays/counties.geojson') },
      cwas: { type: 'geojson', data: siteUrl('overlays/cwas.geojson') },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': '#f3f3ef' } },
      { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', paint: { 'fill-color': '#cfdde6' } },
      anchor(ANCHOR_FILLS),
      {
        id: 'counties', type: 'line', source: 'counties', minzoom: 5,
        paint: { 'line-color': '#7a7d80', 'line-width': 0.5 },
      },
      {
        id: 'highways-casing', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 4,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 3] },
      },
      {
        id: 'highways', type: 'line', source: 'basemap', 'source-layer': 'transportation', minzoom: 4,
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk']]],
        paint: { 'line-color': '#9a5b2e', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 8, 1.5] },
      },
      {
        id: 'cwas', type: 'line', source: 'cwas',
        paint: { 'line-color': '#012169', 'line-width': 1.4, 'line-dasharray': [3, 2] },
      },
      {
        id: 'countries', type: 'line', source: 'basemap', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#222222', 'line-width': 1.6 },
      },
      {
        id: 'states', type: 'line', source: 'basemap', 'source-layer': 'boundary',
        filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
        paint: { 'line-color': '#333333', 'line-width': 1 },
      },
      anchor(ANCHOR_LINES),
      {
        id: 'cwa-labels', type: 'symbol', source: 'cwas', minzoom: 4,
        layout: { 'text-field': ['get', 'CWA'], 'text-font': ['Noto Sans Bold'], 'text-size': 11 },
        paint: { 'text-color': '#012169', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      },
      {
        id: 'cities', type: 'symbol', source: 'basemap', 'source-layer': 'place',
        filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: {
          'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
          'text-font': [LABEL_FONT],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 8, 13],
          'symbol-sort-key': ['get', 'rank'],
          'text-anchor': 'top',
          'text-offset': [0, 0.3],
          'icon-image': '',
        },
        paint: { 'text-color': '#1d1d1f', 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
      },
    ],
  };
}
