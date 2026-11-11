import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { editThermo, type EditOptions, type Profile } from './profile';

const M = { top: 10, right: 54, bottom: 26, left: 40 };
const P_BASE = 1050;
const P_TOP = 450;
const T_MIN = -35;
const T_MAX = 30;
const SKEW = 1 / Math.tan((55 * Math.PI) / 180);
const ISOBARS = [1000, 925, 850, 700, 600, 500];
const T_COLOR = '#c62828';
const TD_COLOR = '#2e7d32';

/** Plot geometry for an SVG of W × H pixels; the diagram is drawn at the size of its container. */
function geometry(W: number, H: number) {
  const w = Math.max(W - M.left - M.right, 60);
  const h = Math.max(H - M.top - M.bottom, 60);
  const yOf = (p: number) => (h * Math.log(p / P_TOP)) / Math.log(P_BASE / P_TOP);
  const xOf = (t: number, p: number) => ((t - T_MIN) / (T_MAX - T_MIN)) * w + (h - yOf(p)) * SKEW;
  return { W, H, w, h, yOf, xOf, degPerPx: (T_MAX - T_MIN) / w };
}
type Geometry = ReturnType<typeof geometry>;

const line = (pts: [number, number][]) => pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/** SVG path for a wind barb with its base at the origin and the staff pointing up. */
export function barbPath(speedKt: number): string {
  let s = Math.round(speedKt / 5) * 5;
  if (s < 5) return 'M-2.5,0A2.5,2.5 0 1,0 2.5,0A2.5,2.5 0 1,0 -2.5,0';
  const L = 24;
  let d = `M0,0L0,${-L}`;
  let pos = -L;
  while (s >= 50) {
    d += `M0,${pos}L9,${pos + 2.5}L0,${pos + 5}Z`;
    pos += 7;
    s -= 50;
  }
  while (s >= 10) {
    d += `M0,${pos}L9,${pos - 3}`;
    pos += 3.5;
    s -= 10;
  }
  if (s >= 5) {
    if (pos === -L) pos += 3.5;
    d += `M0,${pos}L4.5,${pos - 1.5}`;
  }
  return d;
}

/** Quads between the temperature trace and the 0 °C isotherm, split at each crossing. */
function freezingAreas(p: Profile, { xOf, yOf }: Geometry) {
  const pts: { t: number; p: number }[] = [];
  for (let k = 0; k < p.t.length; k++) {
    pts.push({ t: p.t[k], p: p.p[k] });
    if (k < p.t.length - 1 && Math.sign(p.t[k]) !== Math.sign(p.t[k + 1]) && p.t[k] !== p.t[k + 1]) {
      const f = (0 - p.t[k]) / (p.t[k + 1] - p.t[k]);
      pts.push({ t: 0, p: Math.exp(Math.log(p.p[k]) + f * (Math.log(p.p[k + 1]) - Math.log(p.p[k]))) });
    }
  }
  const areas: { d: string; warm: boolean }[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const mean = (a.t + b.t) / 2;
    if (mean === 0) continue;
    areas.push({
      warm: mean > 0,
      d: `${line([[xOf(a.t, a.p), yOf(a.p)], [xOf(b.t, b.p), yOf(b.p)], [xOf(0, b.p), yOf(b.p)], [xOf(0, a.p), yOf(a.p)]])}Z`,
    });
  }
  return areas;
}

interface Props {
  profile: Profile;
  original: Profile;
  modified: boolean;
  edit: EditOptions;
  onEdit(profile: Profile): void;
}

export function SkewT({ profile, original, modified, edit, onEdit }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ W: 400, H: 430 });
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const measure = () => {
      const W = Math.round(el.clientWidth);
      const H = Math.round(el.clientHeight);
      if (W > 0 && H > 0) setSize((s) => (s.W === W && s.H === H ? s : { W, H }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const geom = useMemo(() => geometry(size.W, size.H), [size]);
  const { W, H, w, h, xOf, yOf, degPerPx } = geom;
  const drag = useRef<{ start: Profile; which: 't' | 'td'; idx: number; x0: number } | null>(null);

  const onDown = (which: 't' | 'td', idx: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    drag.current = { start: profile, which, idx, x0: e.clientX };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent<SVGCircleElement>) => {
    const d = drag.current;
    if (!d) return;
    onEdit(editThermo(d.start, d.which, d.idx, (e.clientX - d.x0) * degPerPx, edit));
  };
  const onUp = () => {
    drag.current = null;
  };
  /** Arrow keys nudge the focused point by 0.5 °C. */
  const onKey = (which: 't' | 'td', idx: number) => (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    onEdit(editThermo(profile, which, idx, e.key === 'ArrowLeft' ? -0.5 : 0.5, edit));
  };

  const trace = (t: number[], p: number[]) => line(t.map((v, k) => [xOf(v, p[k]), yOf(p[k])]));
  const isotherms = [];
  for (let t = -100; t <= 40; t += 5) isotherms.push(t);
  const adiabats = [];
  for (let theta = 250; theta <= 330; theta += 10) adiabats.push(theta);
  const pSteps = Array.from({ length: 25 }, (_, k) => P_BASE - k * 25);
  const barbX = w + 30;

  return (
    <div ref={wrapRef} className="skewt-wrap">
    <svg className="skewt" width={W} height={H} role="img" aria-label="Skew-T log-p diagram of temperature and dewpoint with wind barbs">
      <defs>
        <clipPath id="skewt-clip">
          <rect x={0} y={0} width={w} height={h} />
        </clipPath>
      </defs>
      <g transform={`translate(${M.left},${M.top})`}>
        <rect x={0} y={0} width={w} height={h} className="plot-bg" />
        <g clipPath="url(#skewt-clip)">
          {adiabats.map((theta) => (
            <path
              key={theta}
              className="adiabat"
              d={line(pSteps.map((p) => [xOf(theta * Math.pow(p / 1000, 0.2857) - 273.15, p), yOf(p)]))}
            />
          ))}
          {isotherms.map((t) => (
            <line
              key={t}
              className={t === 0 ? 'isotherm zero' : 'isotherm'}
              x1={xOf(t, P_BASE)} y1={h} x2={xOf(t, P_TOP)} y2={0}
            />
          ))}
          {ISOBARS.map((p) => (
            <line key={p} className="isobar" x1={0} x2={w} y1={yOf(p)} y2={yOf(p)} />
          ))}
          {freezingAreas(profile, geom).map((a, k) => (
            <path key={k} d={a.d} className={a.warm ? 'area-warm' : 'area-cold'} />
          ))}
          {modified && (
            <>
              <path className="trace original" d={trace(original.td, original.p)} stroke={TD_COLOR} />
              <path className="trace original" d={trace(original.t, original.p)} stroke={T_COLOR} />
            </>
          )}
          <path className="trace" d={trace(profile.td, profile.p)} stroke={TD_COLOR} />
          <path className="trace" d={trace(profile.t, profile.p)} stroke={T_COLOR} />
          {(['td', 't'] as const).map((which) =>
            profile[which].map((v, k) => (
              <circle
                key={`${which}${k}`}
                className="handle"
                cx={xOf(v, profile.p[k])}
                cy={yOf(profile.p[k])}
                r={4.5}
                fill={which === 't' ? T_COLOR : TD_COLOR}
                tabIndex={0}
                role="slider"
                aria-label={`${which === 't' ? 'Temperature' : 'Dewpoint'} at ${profile.heights[k]} m`}
                aria-valuenow={Number(v.toFixed(1))}
                aria-valuetext={`${v.toFixed(1)} °C`}
                onPointerDown={onDown(which, k)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={onKey(which, k)}
              >
                <title>{`${which === 't' ? 'T' : 'Td'} ${v.toFixed(1)} °C · ${profile.heights[k]} m AGL · ${profile.p[k].toFixed(0)} hPa`}</title>
              </circle>
            )),
          )}
        </g>
        <rect x={0} y={0} width={w} height={h} className="plot-frame" />
        {ISOBARS.map((p) => (
          <text key={p} className="axis-label" x={-5} y={yOf(p)} textAnchor="end" dominantBaseline="middle">{p}</text>
        ))}
        {[-30, -20, -10, 0, 10, 20, 30].map((t) => (
          <text key={t} className="axis-label" x={xOf(t, P_BASE)} y={h + 14} textAnchor="middle">{t}</text>
        ))}
        <text className="axis-title" x={w / 2} y={h + 25} textAnchor="middle">°C</text>
        <text className="axis-title" x={-28} y={-2}>hPa</text>
        {profile.heights.map((z, k) =>
          k % 2 === 0 ? (
            <g key={z} transform={`translate(${barbX},${yOf(profile.p[k])})`}>
              <path
                className="barb"
                d={barbPath(Math.hypot(profile.u[k], profile.v[k]) * 1.94384)}
                transform={`rotate(${(Math.atan2(-profile.u[k], -profile.v[k]) * 180) / Math.PI})`}
              />
            </g>
          ) : null,
        )}
        {profile.heights.map((z, k) =>
          z % 1000 === 0 ? (
            <text key={z} className="height-label" x={w + 3} y={yOf(profile.p[k])} dominantBaseline="middle">{z / 1000} km</text>
          ) : null,
        )}
      </g>
    </svg>
    </div>
  );
}
