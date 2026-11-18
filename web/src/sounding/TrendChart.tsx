/**
 * Model trend at the selected point: the four class probabilities and the uncertainty from every run
 * valid at the time on screen, oldest run on the left and the analysis on the right, like the slider.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { PTYPE_STYLES, UNCERTAINTY_COLOR } from '../config/ptypeStyle';
import { frameIndex, loopFrames, useApp } from '../state/store';
import { formatInit } from '../time/times';
import { leadLabels, validIso, type Frame } from '../time/trend';
import { loadTrendSeries, type TrendValue } from './trendSeries';

const W = 320;
const H = 150;
const PAD = { left: 30, right: 8, top: 8, bottom: 30 };

/**
 * The type colours are the site's own (map, legend, bars), and snow blue and sleet purple are close
 * (measured: colour difference 8.7, 2.4 for red-green colour blindness). So each series also has its own
 * marker shape, and the uncertainty line is dashed.
 */
const SERIES = [
  ...PTYPE_STYLES.map((s, k) => ({ id: s.id as string, label: s.label, color: s.color, shape: (['circle', 'diamond', 'triangle', 'square'] as const)[k], value: (p: NonNullable<TrendValue>) => p.probs[k] })),
  { id: 'u', label: 'Uncertainty', color: UNCERTAINTY_COLOR, shape: 'none' as const, value: (p: NonNullable<TrendValue>) => p.u },
];

function marker(shape: (typeof SERIES)[number]['shape'], x: number, y: number, r: number): string {
  switch (shape) {
    case 'circle': return `M${x - r},${y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
    case 'diamond': return `M${x},${y - r * 1.25}L${x + r * 1.25},${y}L${x},${y + r * 1.25}L${x - r * 1.25},${y}Z`;
    case 'triangle': return `M${x},${y - r * 1.2}L${x + r * 1.15},${y + r * 0.9}L${x - r * 1.15},${y + r * 0.9}Z`;
    case 'square': return `M${x - r * 0.95},${y - r * 0.95}h${r * 1.9}v${r * 1.9}h${-r * 1.9}Z`;
    default: return '';
  }
}

/** The point's forecast from every run of the loop, filled in as the soundings arrive. */
function useTrendSeries(frames: Frame[], key: string | null) {
  const manifest = useApp((s) => s.manifest);
  const [values, setValues] = useState<{ key: string | null; byLead: Map<number, TrendValue> }>({ key: null, byLead: new Map() });
  const framesRef = useRef(frames);
  framesRef.current = frames;
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const byLead = new Map<number, TrendValue>();
    setValues({ key, byLead });
    const point = useApp.getState().point!;
    void loadTrendSeries(framesRef.current, manifest, point.lon, point.lat, (frame, value) => {
      byLead.set(frame.fhour, value);
      setValues({ key, byLead: new Map(byLead) });
    }, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [key, manifest]);
  return values.key === key ? values.byLead : new Map<number, TrendValue>();
}

export function TrendChart() {
  const mode = useApp((s) => s.mode);
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const point = useApp((s) => s.point);
  const setFrame = useApp((s) => s.setFrame);
  const [hover, setHover] = useState<number | null>(null);

  const valid = init ? validIso(init, fhour) : null;
  const frames = useMemo(() => (init && mode === 'trend' ? loopFrames({ mode, init, fhour }) : []), [mode, valid]); // the loop changes only with the valid time
  const key = mode === 'trend' && valid && point ? `${valid}|${point.lon.toFixed(3)},${point.lat.toFixed(3)}` : null;
  const byLead = useTrendSeries(frames, key);
  if (!key || frames.length === 0) return null;

  const n = frames.length;
  const x = (k: number) => PAD.left + (n === 1 ? 0.5 : k / (n - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - v) * (H - PAD.top - PAD.bottom);
  const at = frameIndex(frames, { init, fhour });
  const loaded = frames.filter((f) => byLead.get(f.fhour) !== undefined).length;
  const withForecast = frames.filter((f) => byLead.get(f.fhour)).length;
  // Leads beyond 18 h come only from the six-hourly runs: the steps left of this position are 6 h, right of it 1 h.
  const firstHourly = frames.findIndex((f) => f.fhour <= 18);
  const ticks = leadLabels(frames.map((f) => f.fhour));
  const shown = hover ?? at;
  const shownValue = byLead.get(frames[shown]?.fhour);

  // A line breaks wherever a run has no forecast at the point (or has not loaded yet).
  const path = (value: (p: NonNullable<TrendValue>) => number) => {
    let d = '';
    let pen = false;
    frames.forEach((f, k) => {
      const p = byLead.get(f.fhour);
      if (!p) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(value(p)).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const pick = (e: React.MouseEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - PAD.left - PAD.right);
    return Math.max(0, Math.min(n - 1, Math.round((px / (W - PAD.left - PAD.right)) * (n - 1))));
  };

  return (
    <section className="trend-chart">
      <h3>Model trend at this point</h3>
      <ul className="trend-key">
        {SERIES.map((s) => (
          <li key={s.id}>
            <svg width="18" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="18" y2="5" stroke={s.color} strokeWidth="2" strokeDasharray={s.id === 'u' ? '4 3' : undefined} />
              {s.shape !== 'none' && <path d={marker(s.shape, 9, 5, 3)} fill={s.color} stroke="#fff" strokeWidth="1" />}
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <svg className="trend-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Precipitation type probabilities and uncertainty at this point from each model run, longest lead on the left">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line className="trend-grid" x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            {v % 0.5 === 0 && <text className="trend-tick" x={PAD.left - 4} y={y(v) + 3} textAnchor="end">{v * 100}%</text>}
          </g>
        ))}
        {firstHourly > 0 && <line className="trend-break" x1={x(firstHourly - 0.5)} x2={x(firstHourly - 0.5)} y1={PAD.top} y2={H - PAD.bottom} />}
        {ticks.map(({ index, text }) => (
          <text key={index} className="trend-tick" x={x(index)} y={H - PAD.bottom + 11} textAnchor="middle">{text}</text>
        ))}
        <text className="trend-tick" x={(PAD.left + W - PAD.right) / 2} y={H - 4} textAnchor="middle">
          Lead time (h){firstHourly > 0 ? ' · runs 6 h apart left of the dashed line, 1 h right' : ''}
        </text>
        <line className="trend-now" x1={x(at)} x2={x(at)} y1={PAD.top} y2={H - PAD.bottom} />
        {hover !== null && hover !== at && <line className="trend-hover" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />}
        {SERIES.map((s) => (
          <g key={s.id}>
            <path d={path(s.value)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={s.id === 'u' ? '4 3' : undefined} />
            {s.shape !== 'none' && frames.map((f, k) => {
              const p = byLead.get(f.fhour);
              return p && <path key={k} d={marker(s.shape, x(k), y(s.value(p)), k === shown ? 4 : 2.6)} fill={s.color} stroke="#fff" strokeWidth="1" />;
            })}
          </g>
        ))}
        <rect
          className="trend-hit"
          x={PAD.left - 6}
          y={PAD.top}
          width={W - PAD.left - PAD.right + 12}
          height={H - PAD.top - PAD.bottom}
          onPointerMove={(e) => setHover(pick(e))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => {
            useApp.getState().setPlaying(false);
            setFrame(pick(e));
          }}
        >
          <title>Click to show that run on the map</title>
        </rect>
      </svg>
      <p className="trend-readout" role="status">
        <b>Run {formatInit(frames[shown].init)} · F{String(frames[shown].fhour).padStart(2, '0')}</b>{' '}
        {shownValue === undefined
          ? 'loading…'
          : shownValue === null
            ? 'no precipitation-type forecast'
            : SERIES.map((s) => `${s.label} ${Math.round(s.value(shownValue) * 100)}%`).join(' · ')}
      </p>
      <p className="hint">
        {loaded < n ? `Loading runs: ${loaded}/${n}. ` : withForecast < n ? `${withForecast} of ${n} runs have a precipitation-type forecast here. ` : ''}
        Forecasts as stored, without sounding edits. Click the chart to show a run.
      </p>
      <details className="trend-table">
        <summary>Values as a table</summary>
        <table>
          <thead>
            <tr><th>Run</th><th>Lead</th>{SERIES.map((s) => <th key={s.id}>{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {frames.map((f) => {
              const p = byLead.get(f.fhour);
              return (
                <tr key={f.fhour}>
                  <td>{formatInit(f.init)}</td>
                  <td>F{String(f.fhour).padStart(2, '0')}</td>
                  {SERIES.map((s) => <td key={s.id}>{p ? `${Math.round(s.value(p) * 100)}%` : '–'}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </details>
    </section>
  );
}
