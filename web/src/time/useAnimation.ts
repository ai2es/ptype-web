import { useEffect } from 'react';
import { useApp } from '../state/store';

/** Advances the forecast hour while playing, waiting for the current frame to finish loading. */
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
        s.stepFhour(1);
      }
    };
    timer = window.setTimeout(tick, frameMs);
    return () => window.clearTimeout(timer);
  }, [playing, frameMs, fhour]);
}
