import { FRAME_SPEEDS, frameIndex, loopFrames, useApp, type Mode } from '../state/store';
import { InitPicker } from './InitPicker';
import { formatInit, formatUtc, validDate } from './times';
import { leadLabels } from './trend';

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'run', label: 'Model run', title: 'Step through the forecast hours of one HRRR run' },
  { id: 'trend', label: 'Model trend', title: 'Step through every HRRR run valid at one time, longest lead first (dprog/dt)' },
];

export function TimeBar() {
  const mode = useApp((s) => s.mode);
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const playing = useApp((s) => s.playing);
  const frameMs = useApp((s) => s.frameMs);
  const manifest = useApp((s) => s.manifest);
  const layerStatus = useApp((s) => s.layerStatus);
  const preloadRun = useApp((s) => s.preloadRun);
  const prefetch = useApp((s) => s.prefetch);
  const { setFrame, stepFhour, setPlaying, setFrameMs, setMode } = useApp.getState();

  const trend = mode === 'trend';
  // The slider runs over the frames of the loop, not over hours: in trend mode the leads beyond 18 h are
  // six hours apart and would otherwise take up most of the bar.
  const frames = loopFrames({ mode, init, fhour });
  const at = Math.max(0, frameIndex(frames, { init, fhour }));
  const last = Math.max(1, frames.length - 1);
  const indexOf = new Map(frames.map((f, k) => [f.fhour, k]));
  const entry = init ? manifest?.get(init) : undefined;
  const loading = Object.values(layerStatus).includes('loading');
  // The frame on screen counts as in memory once its layers have drawn, and not before.
  const buffered = preloadRun && prefetch ? [...new Set([...prefetch.ready.filter((h) => h !== fhour), ...(loading ? [] : [fhour])])] : [];
  const missing = trend && prefetch ? prefetch.failed : [];
  const count = `${prefetch?.ready.length ?? 0}/${frames.length}`;
  // Fixed-width text so the bar does not shift as the count changes.
  const preloadLabel = !preloadRun || !prefetch
    ? ''
    : prefetch.active
      ? count
      : prefetch.limited
        ? `${count} (memory limit)`
        : prefetch.failed.length > 0
          ? count
          : 'ready';
  const pause = (fn: () => void) => () => {
    setPlaying(false);
    fn();
  };
  const span = (h: number) => {
    const k = indexOf.get(h);
    if (k === undefined) return null;
    const from = Math.max(0, k - 0.5);
    return { left: `${(from / last) * 100}%`, width: `${((Math.min(last, k + 0.5) - from) / last) * 100}%` };
  };
  const what = trend ? 'run' : 'forecast hour';

  return (
    <div className="timebar">
      <div className="mode-toggle" role="group" aria-label="Loop mode">
        {MODES.map((m) => (
          <button key={m.id} type="button" className={`btn${mode === m.id ? ' btn-primary' : ''}`} title={m.title} aria-pressed={mode === m.id} onClick={pause(() => setMode(m.id))}>
            {m.label}
          </button>
        ))}
      </div>
      <InitPicker />
      <div className="transport" role="group" aria-label={trend ? 'Model run controls' : 'Forecast hour controls'}>
        <button type="button" className="btn icon" title={trend ? 'Longest lead (Home)' : 'First hour (Home)'} aria-label={trend ? 'Longest lead' : 'First forecast hour'} onClick={pause(() => setFrame(0))}>⏮</button>
        <button type="button" className="btn icon" title={trend ? 'Older run (←)' : 'Previous hour (←)'} aria-label={`Previous ${what}`} onClick={pause(() => stepFhour(-1))}>◀</button>
        <button type="button" className="btn icon btn-primary" title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="btn icon" title={trend ? 'Newer run (→)' : 'Next hour (→)'} aria-label={`Next ${what}`} onClick={pause(() => stepFhour(1))}>▶</button>
        <button type="button" className="btn icon" title={trend ? 'Analysis (End)' : 'Last hour (End)'} aria-label={trend ? 'Analysis' : 'Last forecast hour'} onClick={pause(() => setFrame(frames.length - 1))}>⏭</button>
      </div>
      <div className="slider-wrap">
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={at}
          aria-label={trend ? 'Model run, longest lead to analysis' : 'Forecast hour'}
          aria-valuetext={init ? (trend ? `Run ${formatInit(init)}, forecast hour ${fhour}` : `Forecast hour ${fhour}`) : undefined}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />
        <div className="slider-buffer" aria-hidden="true">
          {buffered.map((h) => {
            const style = span(h);
            return style && <span key={h} style={style} />;
          })}
          {missing.map((h) => {
            const style = span(h);
            return style && <span key={`m${h}`} className="missing" style={style} />;
          })}
        </div>
        <div className="slider-scale" aria-hidden="true">
          {(trend ? leadLabels(frames.map((f) => f.fhour)) : frames.filter((f) => f.fhour % 6 === 0).map((f) => ({ index: f.fhour, text: String(f.fhour) }))).map(({ index, text }) => (
            <span key={index} style={{ left: `${(index / last) * 100}%` }}>{text}</span>
          ))}
        </div>
      </div>
      <div className="valid">
        <span className="fhour">F{String(fhour).padStart(2, '0')}</span>
        <span className="valid-time">{!init ? '' : trend ? `Run ${formatInit(init)}` : `Valid ${formatUtc(validDate(init, fhour))}`}</span>
        <span className={`chip ${entry?.forecastHours.includes(fhour) ? 'chip-ok' : 'chip-muted'}`}>
          {loading ? 'Loading…' : entry?.forecastHours.includes(fhour) ? 'Precip type available' : 'HRRR fields only'}
        </span>
      </div>
      <label className="preload" title={`Load the selected layers for every ${trend ? 'run of this loop' : 'forecast hour of this run'} in the background, so stepping and animation do not wait`}>
        <input type="checkbox" checked={preloadRun} onChange={(e) => useApp.getState().set({ preloadRun: e.target.checked })} />
        {trend ? 'Preload loop' : 'Preload run'}
        <span className="preload-status" role="status">{preloadLabel}</span>
      </label>
      <label className="speed">
        <span className="speed-label">Speed</span>
        <select value={frameMs} onChange={(e) => setFrameMs(Number(e.target.value))} aria-label="Animation speed">
          {FRAME_SPEEDS.map((ms) => (
            <option key={ms} value={ms}>{(1000 / ms).toFixed(1)} fps</option>
          ))}
        </select>
      </label>
    </div>
  );
}
