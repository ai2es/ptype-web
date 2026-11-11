import { useRef } from 'react';
import { editWind, type EditOptions, type Profile } from './profile';

const SIZE = 260;
const C = SIZE / 2;
const R = C - 16;
const KT = 1.94384;
/** Height bands (m AGL) and their trace colours. */
const BANDS = [
  { top: 1000, color: '#c62828', label: '0–1 km' },
  { top: 3000, color: '#ef6c00', label: '1–3 km' },
  { top: 5000, color: '#1a658f', label: '3–5 km' },
];
const bandColor = (z: number) => (BANDS.find((b) => z <= b.top) ?? BANDS[BANDS.length - 1]).color;

interface Props {
  profile: Profile;
  original: Profile;
  modified: boolean;
  edit: EditOptions;
  onEdit(profile: Profile): void;
}

export function Hodograph({ profile, original, modified, edit, onEdit }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ start: Profile; idx: number; x0: number; y0: number; scale: number; maxKt: number } | null>(null);

  // Ring spacing follows the strongest wind, but stays fixed during a drag.
  const speeds = [...profile.u.map((u, k) => Math.hypot(u, profile.v[k])), ...original.u.map((u, k) => Math.hypot(u, original.v[k]))];
  const maxKt = drag.current?.maxKt ?? Math.max(20, Math.ceil((Math.max(...speeds) * KT * 1.15) / 10) * 10);
  const ringStep = maxKt <= 40 ? 10 : 20;
  const pxPerKt = R / maxKt;
  const px = (u: number) => C + u * KT * pxPerKt;
  const py = (v: number) => C - v * KT * pxPerKt;
  const rings = [];
  for (let s = ringStep; s <= maxKt; s += ringStep) rings.push(s);

  const onDown = (idx: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    drag.current = { start: profile, idx, x0: e.clientX, y0: e.clientY, scale: SIZE / rect.width, maxKt };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent<SVGCircleElement>) => {
    const d = drag.current;
    if (!d) return;
    const perPx = d.scale / (R / d.maxKt) / KT; // m/s per screen pixel
    onEdit(editWind(d.start, d.idx, (e.clientX - d.x0) * perPx, -(e.clientY - d.y0) * perPx, edit));
  };
  const onUp = () => {
    drag.current = null;
  };
  const onKey = (idx: number) => (e: React.KeyboardEvent) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const d = step[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    onEdit(editWind(profile, idx, d[0], d[1], edit));
  };

  const segments = profile.heights.slice(1).map((z, k) => ({
    key: z,
    color: bandColor(z),
    x1: px(profile.u[k]), y1: py(profile.v[k]), x2: px(profile.u[k + 1]), y2: py(profile.v[k + 1]),
  }));

  return (
    <div className="hodo-wrap">
      <svg ref={svgRef} className="hodograph" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Hodograph of wind from the surface to 5 km">
        <defs>
          <clipPath id="hodo-clip"><circle cx={C} cy={C} r={R + 10} /></clipPath>
        </defs>
        <circle cx={C} cy={C} r={R + 10} className="plot-bg" />
        {rings.map((s) => (
          <g key={s}>
            <circle cx={C} cy={C} r={s * pxPerKt} className="ring" />
            <text className="axis-label" x={C + 3} y={C - s * pxPerKt - 2}>{s}</text>
          </g>
        ))}
        <line className="ring" x1={C - R - 10} x2={C + R + 10} y1={C} y2={C} />
        <line className="ring" x1={C} x2={C} y1={C - R - 10} y2={C + R + 10} />
        <g clipPath="url(#hodo-clip)">
          {modified && (
            <path
              className="trace original"
              stroke="#53565a"
              d={original.u.map((u, k) => `${k ? 'L' : 'M'}${px(u).toFixed(1)},${py(original.v[k]).toFixed(1)}`).join('')}
            />
          )}
          {segments.map((s) => (
            <line key={s.key} className="hodo-seg" stroke={s.color} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} />
          ))}
          {profile.heights.map((z, k) => (
            <circle
              key={z}
              className="handle"
              cx={px(profile.u[k])}
              cy={py(profile.v[k])}
              r={z % 1000 === 0 ? 4.5 : 3.5}
              fill={bandColor(z)}
              tabIndex={0}
              role="slider"
              aria-label={`Wind at ${z} m`}
              aria-valuenow={Math.round(Math.hypot(profile.u[k], profile.v[k]) * KT)}
              aria-valuetext={`${Math.round(Math.hypot(profile.u[k], profile.v[k]) * KT)} knots`}
              onPointerDown={onDown(k)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onKey(k)}
            >
              <title>{`${z} m AGL · ${Math.round(Math.hypot(profile.u[k], profile.v[k]) * KT)} kt from ${Math.round(((Math.atan2(-profile.u[k], -profile.v[k]) * 180) / Math.PI + 360) % 360)}°`}</title>
            </circle>
          ))}
        </g>
        <text className="axis-title" x={SIZE - 6} y={SIZE - 6} textAnchor="end">kt</text>
      </svg>
      <ul className="hodo-key">
        {BANDS.map((b) => (
          <li key={b.label}><i style={{ background: b.color }} />{b.label}</li>
        ))}
        <li className="hint">Rings every {ringStep} kt</li>
      </ul>
    </div>
  );
}
