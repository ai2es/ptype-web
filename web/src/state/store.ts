/** Application state. Components read slices with `useApp(selector)`. */
import { create } from 'zustand';
import { isLowMemoryDevice } from '../config/device';
import type { Manifest } from '../data/manifest';
import type { PlaceId, Places } from '../map/schools';
import type { PrefetchProgress } from '../data/prefetch';
import type { Prediction } from '../model/evidential';
import type { Profile } from '../sounding/profile';
import { initDate, initHour, maxForecastHour, shiftInit, type InitIso } from '../time/times';
import { nearestFrame, runFrames, trendFrames, validIso, type Frame } from '../time/trend';

export type BoundaryId = 'states' | 'counties' | 'cwas' | 'highways' | 'cities';
/** 'run': step through the hours of one run. 'trend': step through the runs valid at one time. */
export type Mode = 'run' | 'trend';
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
  mode: Mode;
  /** The run and forecast hour on screen, in both modes. In trend mode they change together. */
  init: InitIso | null;
  fhour: number;
  playing: boolean;
  /** Milliseconds per animation frame. */
  frameMs: number;
  point: { lon: number; lat: number } | null;
  /** Ids of the HRRR fields drawn on the map (see fields/registry.ts). */
  activeFields: string[];
  showPtype: boolean;
  /** Draw the revised Bourgouin most likely type instead of the network's. */
  showBourgouin: boolean;
  ptypeOpacity: number;
  maskToPrecip: boolean;
  showUncertainty: boolean;
  boundaries: Record<BoundaryId, boolean>;
  /** School and school district layers (map/schools.ts); all off until asked for. */
  places: Places;
  /** 'terrain' adds hill shading and elevation contours to the plain basemap (map/terrain.ts). */
  basemap: 'plain' | 'terrain';
  /** Load state per map layer id, for the layer menu. */
  layerStatus: Record<string, LayerStatus>;
  /** Load the selected layers for every hour of the run in the background. */
  preloadRun: boolean;
  /** How far the background loading has got, for the time bar. */
  prefetch: PrefetchProgress | null;
  sounding: SoundingState;
  /** Gaussian width (in levels) over which a drag is spread. */
  editSigma: number;
  lockRh: boolean;
  helpOpen: boolean;
  aboutOpen: boolean;

  setManifest(m: Manifest | null, error?: string | null): void;
  setInit(init: InitIso): void;
  setFhour(fhour: number): void;
  setMode(mode: Mode): void;
  /** Show frame `index` of the current loop (see `loopFrames`). */
  setFrame(index: number): void;
  /** Move along the loop: forecast hours in run mode, runs in trend mode. Wraps at the ends. */
  stepFhour(delta: number): void;
  /** Run mode: move to another run. Trend mode: move the valid time. */
  stepInit(deltaHours: number): void;
  /** Trend mode: show the forecasts valid at another time, keeping the lead where that run exists. */
  setValid(valid: InitIso): void;
  setPlaying(playing: boolean): void;
  setFrameMs(ms: number): void;
  setPoint(point: { lon: number; lat: number } | null): void;
  toggleField(id: string): void;
  toggleBoundary(id: BoundaryId): void;
  togglePlace(id: PlaceId): void;
  setLayerStatus(id: string, status: LayerStatus | null): void;
  setSounding(patch: Partial<SoundingState>): void;
  set(patch: Partial<AppState>): void;
}

export const FRAME_SPEEDS = [1500, 1000, 700, 450, 300, 180];

/** Highest forecast hour selectable for a run. */
export function maxFhour(init: InitIso | null): number {
  return init ? maxForecastHour(initHour(init)) : 18;
}

/**
 * The frames the slider, the arrow keys and the animation move through, in slider order:
 * the hours of the run, or (trend mode) the runs valid at the time on screen, longest lead first.
 */
export function loopFrames(s: Pick<AppState, 'mode' | 'init' | 'fhour'>): Frame[] {
  if (!s.init) return [];
  if (s.mode !== 'trend') return runFrames(s.init);
  // The run on screen always counts, even one picked ahead of the clock.
  return trendFrames(validIso(s.init, s.fhour), new Date(Math.max(Date.now(), initDate(s.init).getTime())));
}

/** Position of the frame on screen in `frames`, or the nearest lead if it is not one of them. */
export function frameIndex(frames: Frame[], s: Pick<AppState, 'init' | 'fhour'>): number {
  const k = frames.findIndex((f) => f.init === s.init && f.fhour === s.fhour);
  return k >= 0 ? k : nearestFrame(frames, s.fhour);
}

export const useApp = create<AppState>((set, get) => ({
  manifest: null,
  manifestError: null,
  mode: 'run',
  init: null,
  fhour: 1,
  playing: false,
  frameMs: 700,
  point: null,
  activeFields: ['t2m'],
  showPtype: true,
  showBourgouin: false,
  ptypeOpacity: 0.85,
  maskToPrecip: true,
  showUncertainty: false,
  boundaries: { states: true, counties: false, cwas: false, highways: true, cities: true },
  places: { districts: false, publicSchools: false, privateSchools: false },
  basemap: 'plain',
  layerStatus: {},
  // Off by default on phones and tablets: a whole run can exceed what their browsers allow one tab.
  preloadRun: !isLowMemoryDevice(),
  prefetch: null,
  sounding: { status: 'idle' },
  editSigma: 2,
  lockRh: false,
  helpOpen: false,
  aboutOpen: false,

  setManifest: (manifest, error = null) => set({ manifest, manifestError: error }),
  setInit: (init) => set((s) => ({ init, fhour: Math.min(s.fhour, maxFhour(init)) })),
  setFhour: (fhour) => set((s) => ({ fhour: Math.max(0, Math.min(maxFhour(s.init), Math.round(fhour))) })),
  setMode: (mode) => set({ mode }),
  setFrame: (index) => {
    const frames = loopFrames(get());
    if (frames.length === 0) return;
    const f = frames[Math.max(0, Math.min(frames.length - 1, Math.round(index)))];
    set({ init: f.init, fhour: f.fhour });
  },
  stepFhour: (delta) => {
    const frames = loopFrames(get());
    const n = frames.length;
    if (n === 0) return;
    const f = frames[(((frameIndex(frames, get()) + delta) % n) + n) % n];
    set({ init: f.init, fhour: f.fhour });
  },
  stepInit: (deltaHours) => {
    const { init, fhour, mode } = get();
    if (!init) return;
    if (mode === 'trend') get().setValid(shiftInit(validIso(init, fhour), deltaHours));
    else get().setInit(shiftInit(init, deltaHours));
  },
  setValid: (valid) => {
    const frames = trendFrames(valid);
    const k = nearestFrame(frames, get().fhour);
    if (k >= 0) set({ init: frames[k].init, fhour: frames[k].fhour });
  },
  setPlaying: (playing) => set({ playing }),
  setFrameMs: (frameMs) => set({ frameMs }),
  setPoint: (point) => set({ point }),
  toggleField: (id) =>
    set((s) => ({
      activeFields: s.activeFields.includes(id) ? s.activeFields.filter((f) => f !== id) : [...s.activeFields, id],
    })),
  toggleBoundary: (id) => set((s) => ({ boundaries: { ...s.boundaries, [id]: !s.boundaries[id] } })),
  togglePlace: (id) => set((s) => ({ places: { ...s.places, [id]: !s.places[id] } })),
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
