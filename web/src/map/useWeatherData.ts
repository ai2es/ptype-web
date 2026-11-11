/** Loads the data for the selected time and hands it to the map layers. */
import { useEffect, useRef } from 'react';
import { HrrrUnavailable, fetchHrrrMessage } from '../data/hrrr';
import { storeUrl } from '../data/manifest';
import { chooseLevel, openPtypeStore, readPtypeFrame } from '../data/ptype';
import { FIELD_BY_ID } from '../fields/registry';
import { maxFhour, useApp } from '../state/store';
import type { InitIso } from '../time/times';
import { setHoverFrame } from './hoverData';
import { precipMask } from './ptypeField';
import type { WeatherLayers } from './WeatherLayers';

const PRECIP_SEARCHES = [':CRAIN:surface:', ':CSNOW:surface:', ':CICEP:surface:', ':CFRZR:surface:'];

function statusFor(err: unknown) {
  if (!(err instanceof HrrrUnavailable)) console.error('layer failed:', err instanceof Error ? err.stack ?? err.message : String(err));
  return err instanceof HrrrUnavailable ? ('unavailable' as const) : ('error' as const);
}

/** Warm the caches for the next frame so animation does not stall. */
function preload(init: InitIso, fhour: number, fieldIds: string[]) {
  if (fhour > maxFhour(init)) return;
  for (const id of fieldIds) {
    FIELD_BY_ID.get(id)?.load((search) => fetchHrrrMessage(init, fhour, search)).catch(() => undefined);
  }
}

export function useWeatherData(layers: WeatherLayers | null, view: { zoom: number; lat: number }) {
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const activeFields = useApp((s) => s.activeFields);
  const manifest = useApp((s) => s.manifest);
  const showPtype = useApp((s) => s.showPtype);
  const showUncertainty = useApp((s) => s.showUncertainty);
  const maskToPrecip = useApp((s) => s.maskToPrecip);
  const ptypeOpacity = useApp((s) => s.ptypeOpacity);
  const playing = useApp((s) => s.playing);
  const setLayerStatus = useApp((s) => s.setLayerStatus);

  // HRRR fields ------------------------------------------------------------
  const fieldGen = useRef(0);
  const drawn = useRef(new Set<string>());
  useEffect(() => {
    if (!layers || !init) return;
    const gen = ++fieldGen.current;
    for (const id of [...drawn.current]) {
      if (!activeFields.includes(id)) {
        layers.remove(`field-${id}`);
        drawn.current.delete(id);
        setLayerStatus(id, null);
      }
    }
    for (const id of activeFields) {
      const def = FIELD_BY_ID.get(id);
      if (!def) continue;
      drawn.current.add(id);
      setLayerStatus(id, 'loading');
      def
        .load((search) => fetchHrrrMessage(init, fhour, search))
        .then(async (data) => {
          if (gen !== fieldGen.current) return;
          await layers.setField({ ...def, id: `field-${id}` }, data);
          if (gen === fieldGen.current) setLayerStatus(id, 'ok');
        })
        .catch((err) => {
          if (gen !== fieldGen.current) return;
          layers.remove(`field-${id}`);
          setLayerStatus(id, statusFor(err));
        });
    }
    if (playing) preload(init, fhour + 1, activeFields);
  }, [layers, init, fhour, activeFields, playing, setLayerStatus]);

  // Precipitation type and uncertainty ----------------------------------------
  const ptypeGen = useRef(0);
  const zoomBucket = Math.round(view.zoom * 2) / 2;
  const latBucket = Math.round(view.lat / 5) * 5;
  useEffect(() => {
    if (!layers || !init) return;
    const gen = ++ptypeGen.current;
    const stale = () => gen !== ptypeGen.current;
    const clear = (status: 'unavailable' | 'error' | null) => {
      layers.remove('ptype');
      layers.remove('uncertainty');
      setHoverFrame(null, null);
      setLayerStatus('ptype', status);
    };
    const entry = manifest?.get(init);
    if (!entry || !entry.forecastHours.includes(fhour)) {
      clear(manifest ? 'unavailable' : null);
      return;
    }
    if (!showPtype && !showUncertainty) {
      // Keep reading the frame so the hover readout still works.
      layers.remove('ptype');
      layers.remove('uncertainty');
    }
    setLayerStatus('ptype', 'loading');
    (async () => {
      const store = await openPtypeStore(storeUrl(entry));
      const level = chooseLevel(store, zoomBucket, latBucket);
      const frame = await readPtypeFrame(store, level, fhour);
      let mask: Uint8Array | null = null;
      if (maskToPrecip) {
        try {
          const precip = await Promise.all(PRECIP_SEARCHES.map((s) => fetchHrrrMessage(init, fhour, s)));
          mask = precipMask(frame.level.grid, precip);
        } catch (err) {
          // Without the HRRR fields the whole domain is shown; say so in the menu.
          setLayerStatus('ptype-mask', statusFor(err));
        }
        if (mask) setLayerStatus('ptype-mask', 'ok');
      } else {
        setLayerStatus('ptype-mask', null);
      }
      if (stale()) return;
      setHoverFrame(frame, mask);
      await layers.setPtype(showPtype ? frame : null, mask, ptypeOpacity);
      await layers.setUncertainty(showUncertainty ? frame : null, mask);
      if (!stale()) setLayerStatus('ptype', 'ok');
    })().catch((err) => {
      if (stale()) return;
      console.error(err);
      clear('error');
    });
  }, [layers, init, fhour, manifest, showPtype, showUncertainty, maskToPrecip, ptypeOpacity, zoomBucket, latBucket, setLayerStatus]);
}
