/** Application state. Components read slices with `useApp(selector)`. */
import { create } from 'zustand';
import type { Manifest } from '../data/manifest';
import type { Prediction } from '../model/evidential';
import type { Profile } from '../sounding/profile';
import { initHour, maxForecastHour, shiftInit, type InitIso } from '../time/times';

export type BoundaryId = 'states' | 'counties' | 'cwas' | 'highways' | 'cities';
export type LayerStatus = 'loading' | 'ok' | 'unavailable' | 'error';

export interface SoundingState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  message?: string;
  /** Centre of the grid cell the sounding came from. */
  cell?: { lon: number; lat: number };
  original?: Profile;
  current?: Profile;
  originalPrediction?: Prediction;
  prediction?: Prediction;
  modelError?: string;
}

export interface AppState {
  manifest: Manifest | null;
  manifestError: string | null;
  init: InitIso | null;
  fhour: number;
  playing: boolean;
  /** Milliseconds per animation frame. */
  frameMs: number;
  point: { lon: number; lat: number } | null;
  /** Ids of the HRRR fields drawn on the map (see fields/registry.ts). */
  activeFields: string[];
  showPtype: boolean;
  ptypeOpacity: number;
  maskToPrecip: boolean;
  showUncertainty: boolean;
  boundaries: Record<BoundaryId, boolean>;
  /** Load state per map layer id, for the layer menu. */
  layerStatus: Record<string, LayerStatus>;
  sounding: SoundingState;
  /** Gaussian width (in levels) over which a drag is spread. */
  editSigma: number;
  lockRh: boolean;
  helpOpen: boolean;

  setManifest(m: Manifest | null, error?: string | null): void;
  setInit(init: InitIso): void;
  setFhour(fhour: number): void;
  stepFhour(delta: number): void;
  stepInit(deltaHours: number): void;
  setPlaying(playing: boolean): void;
  setFrameMs(ms: number): void;
  setPoint(point: { lon: number; lat: number } | null): void;
  toggleField(id: string): void;
  toggleBoundary(id: BoundaryId): void;
  setLayerStatus(id: string, status: LayerStatus | null): void;
  setSounding(patch: Partial<SoundingState>): void;
  set(patch: Partial<AppState>): void;
}

export const FRAME_SPEEDS = [1500, 1000, 700, 450, 300, 180];

/** Highest forecast hour selectable for a run. */
export function maxFhour(init: InitIso | null): number {
  return init ? maxForecastHour(initHour(init)) : 18;
}

export const useApp = create<AppState>((set, get) => ({
  manifest: null,
  manifestError: null,
  init: null,
  fhour: 1,
  playing: false,
  frameMs: 700,
  point: null,
  activeFields: ['t2m'],
  showPtype: true,
  ptypeOpacity: 0.85,
  maskToPrecip: true,
  showUncertainty: false,
  boundaries: { states: true, counties: false, cwas: false, highways: true, cities: true },
  layerStatus: {},
  sounding: { status: 'idle' },
  editSigma: 2,
  lockRh: false,
  helpOpen: false,

  setManifest: (manifest, error = null) => set({ manifest, manifestError: error }),
  setInit: (init) => set((s) => ({ init, fhour: Math.min(s.fhour, maxFhour(init)) })),
  setFhour: (fhour) => set((s) => ({ fhour: Math.max(0, Math.min(maxFhour(s.init), Math.round(fhour))) })),
  stepFhour: (delta) => {
    const { fhour, init } = get();
    const n = maxFhour(init) + 1;
    set({ fhour: (((fhour + delta) % n) + n) % n });
  },
  stepInit: (deltaHours) => {
    const { init } = get();
    if (init) get().setInit(shiftInit(init, deltaHours));
  },
  setPlaying: (playing) => set({ playing }),
  setFrameMs: (frameMs) => set({ frameMs }),
  setPoint: (point) => set({ point }),
  toggleField: (id) =>
    set((s) => ({
      activeFields: s.activeFields.includes(id) ? s.activeFields.filter((f) => f !== id) : [...s.activeFields, id],
    })),
  toggleBoundary: (id) => set((s) => ({ boundaries: { ...s.boundaries, [id]: !s.boundaries[id] } })),
  setLayerStatus: (id, status) =>
    set((s) => {
      const layerStatus = { ...s.layerStatus };
      if (status === null) delete layerStatus[id];
      else layerStatus[id] = status;
      return { layerStatus };
    }),
  setSounding: (patch) => set((s) => ({ sounding: { ...s.sounding, ...patch } })),
  set: (patch) => set(patch),
}));

if (import.meta.env?.DEV && typeof window !== 'undefined') {
  // Handy in the browser console during development.
  (window as unknown as { __app?: typeof useApp }).__app = useApp;
}
