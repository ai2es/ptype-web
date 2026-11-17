/** Loads the data for the selected time and hands it to the map layers. */
import { useEffect, useRef, useState } from 'react';
import { HrrrUnavailable, fetchHrrrMessage, messageCacheCapacity, releaseHrrrExcept, releaseHrrrMessage } from '../data/hrrr';
import { storeUrl } from '../data/manifest';
import { prefetchOrder, startPrefetch, stopPrefetch } from '../data/prefetch';
import { chooseLevel, frameCacheRoom, hasPtypeFrame, openPtypeStore, readPtypeFrame, releasePtypeExcept } from '../data/ptype';
import { keepOldRuns } from '../debug/memory';
import { FIELD_BY_ID } from '../fields/registry';
import { maxFhour, useApp } from '../state/store';
import type { InitIso } from '../time/times';
import { setHoverFrame } from './hoverData';
import { reflectivityMask, releaseMasksExcept } from './reflectivityMask';
import { canPrebuild, type WeatherLayers } from './WeatherLayers';

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
  const showBourgouin = useApp((s) => s.showBourgouin);
  const maskToPrecip = useApp((s) => s.maskToPrecip);
  const ptypeOpacity = useApp((s) => s.ptypeOpacity);
  const playing = useApp((s) => s.playing);
  const setLayerStatus = useApp((s) => s.setLayerStatus);

  // One run at a time ---------------------------------------------------------
  // Selecting another run lets go of everything loaded for the previous one, so it can be garbage collected
  // (and its graphics buffers deleted) straight away. Without this the old run sat in the caches until pushed
  // out piecemeal, and preloading the new run stopped at "memory limit" after a few hours. This effect comes
  // first so that it runs before the ones below start loading the new run.
  useEffect(() => {
    if (!init || keepOldRuns) return;
    const entry = manifest?.get(init);
    releaseHrrrExcept(init);
    releasePtypeExcept(entry ? storeUrl(entry) : null);
    releaseMasksExcept(init);
    layers?.keepOnlyPrebuilt(`${init}|`);
  }, [layers, init, manifest]);

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
      const layerId = `field-${id}`;
      const hourKey = `${init}|${fhour}`;
      // Contours and barbs are kept as one finished layer per hour, so a preloaded hour needs no data at all.
      if (canPrebuild(def) && layers.showPrebuilt(layerId, hourKey)) {
        setLayerStatus(id, 'ok');
        continue;
      }
      setLayerStatus(id, 'loading');
      const used: string[] = [];
      def
        .load((search) => {
          used.push(search);
          return fetchHrrrMessage(init, fhour, search);
        })
        .then(async (data) => {
          if (canPrebuild(def)) {
            // Build even if the user has moved on: the hour stays available for when they come back.
            await layers.prebuildField({ ...def, id: layerId }, hourKey, data);
            // The layer now lives in graphics memory; the decoded messages behind it are not needed again.
            for (const search of used) releaseHrrrMessage(init, fhour, search);
            if (gen !== fieldGen.current) return;
            layers.showPrebuilt(layerId, hourKey);
            setLayerStatus(id, 'ok');
            return;
          }
          if (gen !== fieldGen.current) return;
          await layers.setField({ ...def, id: layerId }, data);
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
      layers.remove('bourgouin');
      layers.remove('uncertainty');
      setHoverFrame(null, null);
      setLayerStatus('ptype', status);
      setLayerStatus('bourgouin', showBourgouin ? status : null);
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
          // Composite reflectivity above 0 dBZ: unlike the categorical types, it is there at forecast hour 0.
          mask = await reflectivityMask(init, fhour, frame.level);
          setLayerStatus('ptype-mask', 'ok');
        } catch (err) {
          // Fall back to the store's own mask (HRRR categorical types) when it has one; otherwise the
          // whole domain is shown, and the menu says so.
          mask = frame.mask ?? null;
          setLayerStatus('ptype-mask', mask ? 'ok' : statusFor(err));
        }
      } else {
        setLayerStatus('ptype-mask', null);
      }
      if (stale()) return;
      setHoverFrame(frame, mask);
      await layers.setPtype(showPtype ? frame : null, mask, ptypeOpacity);
      await layers.setUncertainty(showUncertainty ? frame : null, mask);
      if (stale()) return;
      setLayerStatus('ptype', 'ok');
      // The revised Bourgouin diagnosis, from the same store and with the same mask, colours and opacity.
      if (!showBourgouin) {
        layers.remove('bourgouin');
        setLayerStatus('bourgouin', null);
      } else if (!store.hasBourgouin) {
        layers.remove('bourgouin');
        setLayerStatus('bourgouin', 'unavailable');
      } else {
        setLayerStatus('bourgouin', 'loading');
        const bourgouin = await readPtypeFrame(store, level, fhour, 'BOURG');
        if (stale()) return;
        await layers.setPtype(bourgouin, mask, ptypeOpacity, 'bourgouin');
        if (!stale()) setLayerStatus('bourgouin', 'ok');
      }
    })().catch((err) => {
      if (stale()) return;
      console.error(err);
      clear('error');
    });
  }, [layers, init, fhour, manifest, showPtype, showBourgouin, showUncertainty, maskToPrecip, ptypeOpacity, zoomBucket, latBucket, setLayerStatus]);

  // The rest of the run, in the background -------------------------------------
  // Deliberately not keyed on the forecast hour: stepping through the run must not restart the loading.
  const preloadRun = useApp((s) => s.preloadRun);
  const fieldKey = [...activeFields].sort().join(',');
  // When the run does not fit in memory, loading stops part way. If the user then moves to an hour that was
  // not reached, start again from there (the oldest hours are dropped to make room).
  const [restart, setRestart] = useState(0);
  const startedAt = useRef(-1);
  const prefetch = useApp((s) => s.prefetch);
  useEffect(() => {
    if (prefetch?.limited && !prefetch.active && fhour !== startedAt.current && !prefetch.ready.includes(fhour)) setRestart((n) => n + 1);
  }, [fhour, prefetch]);
  useEffect(() => {
    const { set } = useApp.getState();
    if (!layers || !init || !preloadRun) {
      stopPrefetch();
      set({ prefetch: null });
      return;
    }
    const entry = manifest?.get(init);
    const fields = fieldKey ? fieldKey.split(',') : [];
    const key = `${init}|${fieldKey}|${entry ? `${zoomBucket}/${latBucket}/${maskToPrecip}/${showBourgouin}` : 'no-ptype'}`;
    set({ prefetch: null });
    // Wait a moment so the frame on screen gets the first requests, and so quick changes do not each start a load.
    const timer = window.setTimeout(() => {
      const hours = Array.from({ length: maxFhour(init) + 1 }, (_, h) => h);
      startedAt.current = useApp.getState().fhour;
      startPrefetch(
        {
          key,
          hours: prefetchOrder(useApp.getState().fhour, hours),
          // Keep room for the frame on screen, whose messages share the cache.
          messageBudget: messageCacheCapacity() - 10,
          fetchMessage: (fh, search) => fetchHrrrMessage(init, fh, search),
          loadHour: async (fh, fetch) => {
            const hourKey = `${init}|${fh}`;
            // Messages that only fed a prebuilt layer are released afterwards; those a filled layer or the
            // mask needs stay cached, and only they count against the memory budget (through `fetch`).
            const built = new Set<string>();
            const kept = new Set<string>();
            const keep = (search: string) => {
              kept.add(search);
              return fetch(search);
            };
            const jobs: Promise<unknown>[] = fields.map(async (id) => {
              const def = FIELD_BY_ID.get(id);
              if (!def) return;
              if (!canPrebuild(def)) return def.load(keep);
              const layerId = `field-${id}`;
              if (layers.hasPrebuilt(layerId, hourKey)) return;
              const data = await def.load((search) => {
                built.add(search);
                return fetchHrrrMessage(init, fh, search);
              });
              await layers.prebuildField({ ...def, id: layerId }, hourKey, data);
            });
            let fits = true;
            if (entry?.forecastHours.includes(fh)) {
              const store = await openPtypeStore(storeUrl(entry));
              const level = chooseLevel(store, zoomBucket, latBucket);
              if (!hasPtypeFrame(store, level, fh) && frameCacheRoom(store, level) < 1) fits = false;
              else {
                if (showBourgouin && store.hasBourgouin) jobs.push(readPtypeFrame(store, level, fh, 'BOURG'));
                jobs.push(readPtypeFrame(store, level, fh));
                // Only the mask is kept; the reflectivity field is released once it is built.
                if (maskToPrecip) jobs.push(reflectivityMask(init, fh, store.levels[level]).catch(() => undefined));
              }
            }
            await Promise.all(jobs);
            for (const search of built) if (!kept.has(search)) releaseHrrrMessage(init, fh, search);
            return fits;
          },
        },
        (progress) => useApp.getState().set({ prefetch: progress }),
      );
    }, 600);
    return () => {
      window.clearTimeout(timer);
      stopPrefetch();
    };
  }, [layers, init, fieldKey, manifest, preloadRun, maskToPrecip, showBourgouin, zoomBucket, latBucket, restart]);
}
