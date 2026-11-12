import { useEffect } from 'react';
import { FRAME_SPEEDS, maxFhour, useApp } from '../state/store';

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: '← / →  or  , / .', action: 'Previous / next forecast hour' },
  { keys: 'Space', action: 'Play or pause the animation' },
  { keys: 'Home / End', action: 'First / last forecast hour' },
  { keys: 'Shift + ← / →', action: 'Previous / next model run (1 hour)' },
  { keys: '[ / ]', action: 'Slower / faster animation' },
  { keys: 'Esc', action: 'Stop animation, close dialogs' },
  { keys: '?', action: 'Show this help' },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button'].includes(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      const s = useApp.getState();
      const speed = (delta: number) => {
        const k = FRAME_SPEEDS.indexOf(s.frameMs);
        const next = Math.max(0, Math.min(FRAME_SPEEDS.length - 1, (k < 0 ? 2 : k) + delta));
        s.setFrameMs(FRAME_SPEEDS[next]);
      };
      const step = (delta: number) => {
        s.setPlaying(false);
        if (e.shiftKey) s.stepInit(delta);
        else s.stepFhour(delta);
      };
      switch (e.key) {
        case 'ArrowLeft': step(-1); break;
        case 'ArrowRight': step(1); break;
        case ',': case '<': s.setPlaying(false); s.stepFhour(-1); break;
        case '.': case '>': s.setPlaying(false); s.stepFhour(1); break;
        case ' ': s.setPlaying(!s.playing); break;
        case 'Home': s.setPlaying(false); s.setFhour(0); break;
        case 'End': s.setPlaying(false); s.setFhour(maxFhour(s.init)); break;
        case '[': speed(-1); break;
        case ']': speed(1); break;
        case '?': s.set({ helpOpen: !s.helpOpen }); break;
        case 'Escape': s.setPlaying(false); s.set({ helpOpen: false, aboutOpen: false }); break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
