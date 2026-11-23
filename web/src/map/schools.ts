/**
 * School locations and unified school district boundaries (NCES EDGE), drawn from one vector-tile archive
 * built by tools/build_schools.sh.
 *
 * Nothing here loads until one of the three toggles is first switched on: the archive reader is imported on
 * demand and the archive is read with byte-range requests, so only the tiles in view are downloaded.
 *
 * Where the layers sit, and why:
 *   - district outlines go above the weather fills with the other boundaries, so they stay readable over an
 *     opaque field;
 *   - school dots go above the contours and wind barbs, below the place labels;
 *   - an invisible district fill exists only so the pointer can ask which district it is over.
 */
import type * as maplibregl from 'maplibre-gl';
import { siteUrl } from '../config/dataSources';
import { ANCHOR_LINES } from './style';

export type PlaceId = 'districts' | 'publicSchools' | 'privateSchools';
export const PLACE_IDS: PlaceId[] = ['districts', 'publicSchools', 'privateSchools'];
export type Places = Record<PlaceId, boolean>;

export const SCHOOLS_ARCHIVE = 'overlays/schools.pmtiles';
export const SCHOOLS_ATTRIBUTION =
  'Schools and districts: <a href="https://nces.ed.gov/programs/edge" target="_blank" rel="noreferrer">NCES EDGE</a>';
/** The archive holds districts from zoom 5 and schools at zoom 8; the map stretches zoom 8 up to its limit. */
const DISTRICT_MIN_ZOOM = 6;
const SCHOOL_MIN_ZOOM = 8;
export const DISTRICT_COLOR = '#6a3d9a';
const SCHOOL_COLOR = '#1d1d1f';

/** Style layer ids controlled by each toggle. */
export const PLACE_LAYERS: Record<PlaceId, string[]> = {
  districts: ['districts-hit', 'districts', 'district-labels'],
  publicSchools: ['schools-public'],
  privateSchools: ['schools-private'],
};
/** Layers the pointer is tested against, nearest the reader first. */
const HOVER_LAYERS = ['schools-public', 'schools-private', 'districts-hit'];

/** Short names used in the page address (`?places=districts,public,private`). */
const URL_NAMES: Record<PlaceId, string> = { districts: 'districts', publicSchools: 'public', privateSchools: 'private' };

export function parsePlaces(value: string | null): Places {
  const names = new Set((value ?? '').split(','));
  return {
    districts: names.has(URL_NAMES.districts),
    publicSchools: names.has(URL_NAMES.publicSchools),
    privateSchools: names.has(URL_NAMES.privateSchools),
  };
}

export function formatPlaces(places: Places): string {
  return PLACE_IDS.filter((id) => places[id]).map((id) => URL_NAMES[id]).join(',');
}

export interface PlaceFeature {
  layer: string;
  properties: Record<string, unknown>;
  /** Point features only. */
  lngLat?: [number, number];
}

export interface PlaceHover {
  /** Text for the school under the pointer, if any. */
  school?: string;
  /** Where that school is, so a click can open the sounding at the school itself. */
  schoolLngLat?: [number, number];
  /** Text for the district under the pointer, if any. */
  district?: string;
}

/** NCES writes some names in capitals ("WASHINGTON ACADEMY"); those are shown in title case. */
export function tidyName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s\-/(.])([a-z])/g, (_, lead: string, letter: string) => lead + letter.toUpperCase());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** "PK–12" from the district's lowest and highest grade codes; empty if either is missing. */
export function gradeRange(lo: unknown, hi: unknown): string {
  const a = text(lo);
  const b = text(hi);
  if (!a || !b) return '';
  const name = (g: string) => (g === 'KG' ? 'K' : g.replace(/^0/, ''));
  return `${name(a)}–${name(b)}`;
}

/** What to say about the features under the pointer: the first school, and the first district. */
export function describePlaces(features: PlaceFeature[]): PlaceHover | null {
  const out: PlaceHover = {};
  for (const f of features) {
    const name = tidyName(text(f.properties.NAME));
    if (!name) continue;
    if (f.layer === 'districts-hit') {
      if (out.district) continue;
      const grades = gradeRange(f.properties.LOGRADE, f.properties.HIGRADE);
      out.district = grades ? `${name} (${grades})` : name;
    } else if (!out.school) {
      const where = [tidyName(text(f.properties.CITY)), text(f.properties.STATE)].filter(Boolean).join(', ');
      const kind = f.layer === 'schools-private' ? 'private' : 'public';
      out.school = `${name} · ${where ? `${where} · ` : ''}${kind}`;
      out.schoolLngLat = f.lngLat;
    }
  }
  return out.school || out.district ? out : null;
}

let protocol: Promise<void> | null = null;

/** Register the archive reader with MapLibre once, however many times the layers are switched. */
function setupProtocol(lib: typeof maplibregl): Promise<void> {
  protocol ??= import('pmtiles').then(({ Protocol }) => {
    lib.addProtocol('pmtiles', new Protocol().tile);
  });
  return protocol;
}

async function addSchoolLayers(lib: typeof maplibregl, map: maplibregl.Map): Promise<void> {
  await setupProtocol(lib);
  if (map.getSource('schools')) return;
  map.addSource('schools', { type: 'vector', url: `pmtiles://${siteUrl(SCHOOLS_ARCHIVE)}`, attribution: SCHOOLS_ATTRIBUTION });
  const hidden = { visibility: 'none' as const };
  map.addLayer(
    { id: 'districts-hit', type: 'fill', source: 'schools', 'source-layer': 'districts', minzoom: DISTRICT_MIN_ZOOM, layout: hidden, paint: { 'fill-opacity': 0 } },
    ANCHOR_LINES,
  );
  map.addLayer(
    {
      id: 'districts', type: 'line', source: 'schools', 'source-layer': 'districts', minzoom: DISTRICT_MIN_ZOOM, layout: hidden,
      paint: { 'line-color': DISTRICT_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 1.6] },
    },
    ANCHOR_LINES,
  );
  const dot = { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 10, 4.5] as maplibregl.ExpressionSpecification };
  // Public schools are solid dots and private schools rings, so the two differ in shape and not only in colour.
  map.addLayer(
    {
      id: 'schools-private', type: 'circle', source: 'schools', 'source-layer': 'private', minzoom: SCHOOL_MIN_ZOOM, layout: hidden,
      paint: { ...dot, 'circle-color': '#ffffff', 'circle-stroke-color': SCHOOL_COLOR, 'circle-stroke-width': 1.3 },
    },
    'cwa-labels',
  );
  map.addLayer(
    {
      id: 'schools-public', type: 'circle', source: 'schools', 'source-layer': 'public', minzoom: SCHOOL_MIN_ZOOM, layout: hidden,
      paint: { ...dot, 'circle-color': SCHOOL_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
    },
    'cwa-labels',
  );
  map.addLayer(
    {
      id: 'district-labels', type: 'symbol', source: 'schools', 'source-layer': 'district_labels', minzoom: SCHOOL_MIN_ZOOM,
      layout: { ...hidden, 'text-field': ['get', 'NAME'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 8 },
      paint: { 'text-color': DISTRICT_COLOR, 'text-halo-color': 'rgba(255,255,255,0.9)', 'text-halo-width': 1.4 },
    },
    'cities',
  );
}

/** Show or hide the school and district layers, creating them the first time one is wanted. */
export async function setPlaces(lib: typeof maplibregl, map: maplibregl.Map, places: Places): Promise<void> {
  if (PLACE_IDS.some((id) => places[id])) await addSchoolLayers(lib, map);
  for (const id of PLACE_IDS) {
    for (const layer of PLACE_LAYERS[id]) {
      if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', places[id] ? 'visible' : 'none');
    }
  }
}

/** The school and district under a screen point, or null when those layers are off or nothing is there. */
export function placesAt(map: maplibregl.Map, point: { x: number; y: number }): PlaceHover | null {
  const layers = HOVER_LAYERS.filter((id) => map.getLayer(id));
  if (layers.length === 0) return null;
  // A few pixels of slack: a school dot is at most nine pixels across.
  const box: [[number, number], [number, number]] = [[point.x - 4, point.y - 4], [point.x + 4, point.y + 4]];
  const found = map.queryRenderedFeatures(box, { layers });
  return describePlaces(
    found.map((f) => ({
      layer: f.layer.id,
      properties: f.properties ?? {},
      lngLat: f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : undefined,
    })),
  );
}
