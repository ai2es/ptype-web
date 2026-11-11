import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { siteUrl } from '../config/dataSources';
import { PTYPE_STYLES } from '../config/ptypeStyle';
import { useApp, type BoundaryId } from '../state/store';
import { sampleHover, type HoverValue } from './hoverData';
import { BOUNDARY_LAYERS, buildStyle } from './style';
import { useWeatherData } from './useWeatherData';
import { WeatherLayers } from './WeatherLayers';

// The worker is a static file copied by vite.config.ts.
maplibregl.setWorkerUrl(siteUrl('maplibre/maplibre-gl-worker.mjs'));

const INITIAL_VIEW = { center: [-96.5, 41.5] as [number, number], zoom: 4.4 };

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [layers, setLayers] = useState<WeatherLayers | null>(null);
  const [view, setView] = useState({ zoom: INITIAL_VIEW.zoom, lat: INITIAL_VIEW.center[1] });
  const [hover, setHover] = useState<(HoverValue & { lon: number; lat: number }) | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const boundaries = useApp((s) => s.boundaries);
  const point = useApp((s) => s.point);

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: buildStyle(),
        ...INITIAL_VIEW,
        minZoom: 3,
        maxZoom: 10,
        dragRotate: false,
        pitchWithRotate: false,
        keyboard: false, // arrow keys step through time instead
        attributionControl: { compact: true },
      });
    } catch (err) {
      setMapError('This browser could not start WebGL, which the map needs.');
      console.error(err);
      return;
    }
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.on('error', (e) => console.error('map error:', e.error?.message ?? e));
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right');
    // Custom layers can be added as soon as the style is in place; no need to wait for tiles.
    map.once('style.load', () => setLayers(new WeatherLayers(map)));
    map.on('moveend', () => setView({ zoom: map.getZoom(), lat: map.getCenter().lat }));
    map.on('click', (e) => useApp.getState().setPoint({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
    map.on('mousemove', (e) => {
      const v = sampleHover(e.lngLat.lng, e.lngLat.lat);
      setHover(v ? { ...v, lon: e.lngLat.lng, lat: e.lngLat.lat } : null);
    });
    map.on('mouseout', () => setHover(null));
    map.getCanvas().style.cursor = 'crosshair';
    return () => {
      mapRef.current = null;
      setLayers(null);
      map.remove();
    };
  }, []);

  useWeatherData(layers, view);

  // Boundary overlay toggles.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layers) return;
    for (const [id, layerIds] of Object.entries(BOUNDARY_LAYERS)) {
      for (const layerId of layerIds) {
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', boundaries[id as BoundaryId] ? 'visible' : 'none');
        }
      }
    }
  }, [boundaries, layers]);

  // Marker at the selected sounding point.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = point
      ? new maplibregl.Marker({ color: '#012169' }).setLngLat([point.lon, point.lat]).addTo(map)
      : null;
  }, [point, layers]);

  return (
    <div className="map-wrap">
      <div ref={container} className="map" aria-label="Forecast map. Click a point to open its sounding." />
      {mapError && <div className="map-error">{mapError}</div>}
      {hover && (
        <div className="hover-readout" aria-hidden="true">
          <div className="hover-coords">
            {hover.lat.toFixed(2)}°, {hover.lon.toFixed(2)}°{hover.shown ? '' : ' · no HRRR precip'}
          </div>
          {PTYPE_STYLES.map((s, k) => (
            <span key={s.id} style={{ color: s.color }}>
              {s.label} {Math.round(hover.probs[k] * 100)}%
            </span>
          ))}
          <span>Uncertainty {hover.u.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
}
