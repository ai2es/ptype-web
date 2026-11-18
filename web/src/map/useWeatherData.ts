/** Loads the data for the selected time and hands it to the map layers. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { HrrrUnavailable, fetchHrrrMessage, messageCacheCapacity, releaseHrrrExcept, releaseHrrrMessage } from '../data/hrrr';
import { storeUrl } from '../data/manifest';
import { prefetchOrder, startPrefetch, stopPrefetch } from '../data/prefetch';
import { chooseLevel, frameCacheRoom, hasPtypeFrame, openPtypeStore, readPtypeFrame, releasePtypeExcept } from '../data/ptype';
import { keepOldRuns, memoryDebug } from '../debug/memory';
import { FIELD_BY_ID } from '../fields/registry';
import { frameIndex, loopFrames, useApp } from '../state/store';
import { validIso, type Frame, type KeepFrame } from '../time/trend';
import { setHoverFrame } from './hoverData';
import { reflectivityMask, releaseMasksExcept } from './reflectivityMask';
import { canPrebuild, type WeatherLayers } from './WeatherLayers';

function statusFor(err: unknown) {
  if (!(err instanceof HrrrUnavailable)) console.error('layer failed:', err instanceof Error ? err.stack ?? err.message : String(err));
  return err instanceof HrrrUnavailable ? ('unavailable' as const) : ('error' as const);
}

/** Warm the caches for the next frame so animation does not stall. */
function preload({ init, fhour }: Frame, fieldIds: string[]) {
  for (const id of fieldIds) {
    FIELD_BY_ID.get(id)?.load((search) => fetchHrrrMessage(init, fhour, search)).catch(() => undefined);
  }
}

export function useWeatherData(layers: WeatherLayers | null, view: { zoom: number; lat: number }) {
  const mode = useApp((s) => s.mode);
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  // The loop being stepped through: the hours of a run, or (trend mode) the runs valid at one time. It
  // changes with the run or the valid time, not with every step.
  const loopKey = !init ? null : mode === 'trend' ? `trend|${validIso(init, fhour)}` : `run|${init}`;
  const loop = useMemo(() => loopFrames({ mode, init, fhour }), [loopKey]);
  const activeFields = useApp((s) => s.activeFields);
  const manifest = useApp((s) => s.manifest);
  const showPtype = useApp((s) => s.showPtype);
  const showUncertainty = useApp((s) => s.showUncertainty);
  const showBourgouin = useApp((s) => s.showBourgouin);
  const maskToPrecip = useApp((s) => s.maskToPrecip);
  const ptypeOpacity = useApp((s) => s.ptypeOpacity);
  const playing = useApp((s) => s.playing);
  const setLayerStatus = useApp((s) => s.setLayerStatus);

  // One loop at a time --------------------------------------------------------
  // Selecting another run (or, in trend mode, another valid time) lets go of everything loaded for the
  // previous one, so it can be garbage collected (and its graphics buffers deleted) straight away. Without
  // this the old data sat in the caches until pushed out piecemeal, and preloading the new run stopped at
  // "memory limit" after a few hours. A trend loop keeps one forecast hour of each of its runs; a run keeps
  // all of its hours. This effect comes first so that it runs before the ones below start loading.
  useEffect(() => {
    if (!init || keepOldRuns) return;
    const keep: KeepFrame[] = mode === 'trend' ? loop : [{ init }];
    releaseHrrrExcept(keep);
    releasePtypeExcept(
      keep.flatMap((k) => {
        const entry = manifest?.get(k.init);
        return entry ? [{ url: storeUrl(entry), fhour: k.fhour }] : [];
      }),
    );
    releaseMasksExcept(keep);
    layers?.keepOnlyPrebuilt(keep);
    // `loop` and `mode` change only together with `loopKey`.
  }, [layers, loopKey, manifest]);

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
      const started = performance.now();
      def
        .load((search) => {
          used.push(search);
          return fetchHrrrMessage(init, fhour, search);
        })
        .then(async (data) => {
          if (canPrebuild(def)) {
            const loaded = performance.now();
            // Build even if the user has moved on: the hour stays available for when they come back.
            await layers.prebuildField({ ...def, id: layerId }, hourKey, data);
            // With ?memdebug: how long the download and decode took, and how long building the layer took.
            if (memoryDebug) console.info(`[timing] ${id} F${fhour} load ${Math.round(loaded - started)} ms build ${Math.round(performance.now() - loaded)} ms`);
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
    if (playing) {
      const frames = loopFrames({ mode, init, fhour });
      const next = frames[(frameIndex(frames, { init, fhour }) + 1) % frames.length];
      if (next) preload(next, activeFields);
    }
  }, [layers, mode, init, fhour, activeFields, playing, setLayerStatus]);

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
      await layers.setUncertainty(showUncertainty ? frame : null, mask, `${init}|${fhour}|${frame.level.path}|${mask ? 'masked' : 'all'}`);
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

  // The rest of the loop, in the background ------------------------------------
  // Deliberately keyed on the loop, not on the frame: stepping through it must not restart the loading.
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
    const fields = fieldKey ? fieldKey.split(',') : [];
    const key = `${loopKey}|${fieldKey}|${zoomBucket}/${latBucket}/${maskToPrecip}/${showBourgouin}`;
    // The loader works in forecast hours; within one loop each frame has its own.
    const frameOf = new Map(loop.map((f) => [f.fhour, f]));
    set({ prefetch: null });
    // Wait a moment so the frame on screen gets the first requests, and so quick changes do not each start a load.
    const timer = window.setTimeout(() => {
      const now = useApp.getState();
      startedAt.current = now.fhour;
      // Nearest first: the frames after the one on screen, then round to the start of the loop.
      const at = frameIndex(loop, now);
      const hours = mode === 'trend'
        ? [...loop.slice(at + 1), ...loop.slice(0, Math.max(0, at))].map((f) => f.fhour)
        : prefetchOrder(now.fhour, loop.map((f) => f.fhour));
      startPrefetch(
        {
          key,
          hours,
          // Keep room for the frame on screen, whose messages share the cache.
          messageBudget: messageCacheCapacity() - 10,
          fetchMessage: (fh, search) => fetchHrrrMessage(frameOf.get(fh)!.init, fh, search),
          loadHour: async (fh, fetch) => {
            const init = frameOf.get(fh)!.init;
            const entry = manifest?.get(init);
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
        // The loader skips the frame that was on screen when it started, because the effects above load that
        // one. Count it as in memory all the same; otherwise it drops out of the time bar's loaded marks as
        // soon as the user steps away from it.
        (progress) => useApp.getState().set({ prefetch: { ...progress, ready: [...progress.ready, now.fhour] } }),
      );
    }, 600);
    return () => {
      window.clearTimeout(timer);
      stopPrefetch();
    };
  }, [layers, loopKey, fieldKey, manifest, preloadRun, maskToPrecip, showBourgouin, zoomBucket, latBucket, restart]);
}
