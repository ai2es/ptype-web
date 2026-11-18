import { useEffect } from 'react';
import { frameIndex, loopFrames, useApp } from '../state/store';

/** Advances the loop while playing, waiting for the current frame to finish loading. */
export function useAnimation() {
  const playing = useApp((s) => s.playing);
  const frameMs = useApp((s) => s.frameMs);
  const fhour = useApp((s) => s.fhour);

  useEffect(() => {
    if (!playing) return;
    let timer: number;
    const started = performance.now();
    const tick = () => {
      const s = useApp.getState();
      const busy = Object.values(s.layerStatus).includes('loading');
      // Hold the frame until its data is drawn (but never stall for more than 15 s).
      if (busy && performance.now() - started < 15000) {
        timer = window.setTimeout(tick, 80);
      } else {
        // A trend loop can include runs that are not on NOAA's bucket; pass over the ones known to be missing.
        const frames = loopFrames(s);
        const missing = new Set(s.mode === 'trend' ? s.prefetch?.failed ?? [] : []);
        const at = frameIndex(frames, s);
        let step = 1;
        while (step < frames.length && missing.has(frames[(at + step) % frames.length].fhour)) step++;
        s.stepFhour(step);
      }
    };
    timer = window.setTimeout(tick, frameMs);
    return () => window.clearTimeout(timer);
  }, [playing, frameMs, fhour]);
}
