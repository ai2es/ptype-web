import { FRAME_SPEEDS, maxFhour, useApp } from '../state/store';
import { InitPicker } from './InitPicker';
import { formatUtc, validDate } from './times';

export function TimeBar() {
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const playing = useApp((s) => s.playing);
  const frameMs = useApp((s) => s.frameMs);
  const manifest = useApp((s) => s.manifest);
  const layerStatus = useApp((s) => s.layerStatus);
  const { setFhour, stepFhour, setPlaying, setFrameMs } = useApp.getState();

  const max = maxFhour(init);
  const entry = init ? manifest?.get(init) : undefined;
  const loading = Object.values(layerStatus).includes('loading');
  const pause = (fn: () => void) => () => {
    setPlaying(false);
    fn();
  };

  return (
    <div className="timebar">
      <InitPicker />
      <div className="transport" role="group" aria-label="Forecast hour controls">
        <button type="button" className="btn icon" title="First hour (Home)" aria-label="First forecast hour" onClick={pause(() => setFhour(0))}>⏮</button>
        <button type="button" className="btn icon" title="Previous hour (←)" aria-label="Previous forecast hour" onClick={pause(() => stepFhour(-1))}>◀</button>
        <button type="button" className="btn icon btn-primary" title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)}>
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" className="btn icon" title="Next hour (→)" aria-label="Next forecast hour" onClick={pause(() => stepFhour(1))}>▶</button>
        <button type="button" className="btn icon" title="Last hour (End)" aria-label="Last forecast hour" onClick={pause(() => setFhour(max))}>⏭</button>
      </div>
      <div className="slider-wrap">
        <input
          type="range"
          min={0}
          max={max}
          step={1}
          value={fhour}
          aria-label="Forecast hour"
          onChange={(e) => {
            setPlaying(false);
            setFhour(Number(e.target.value));
          }}
        />
        <div className="slider-scale" aria-hidden="true">
          {Array.from({ length: Math.floor(max / 6) + 1 }, (_, k) => k * 6).map((h) => (
            <span key={h} style={{ left: `${(h / max) * 100}%` }}>{h}</span>
          ))}
        </div>
      </div>
      <div className="valid">
        <span className="fhour">F{String(fhour).padStart(2, '0')}</span>
        <span className="valid-time">{init ? `Valid ${formatUtc(validDate(init, fhour))}` : ''}</span>
        <span className={`chip ${entry?.forecastHours.includes(fhour) ? 'chip-ok' : 'chip-muted'}`}>
          {loading ? 'Loading…' : entry?.forecastHours.includes(fhour) ? 'Precip type available' : 'HRRR fields only'}
        </span>
      </div>
      <label className="speed">
        Speed
        <select value={frameMs} onChange={(e) => setFrameMs(Number(e.target.value))} aria-label="Animation speed">
          {FRAME_SPEEDS.map((ms) => (
            <option key={ms} value={ms}>{(1000 / ms).toFixed(1)} fps</option>
          ))}
        </select>
      </label>
    </div>
  );
}
