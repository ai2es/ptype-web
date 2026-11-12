import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { latestHrrrInit } from '../state/startup';
import { useApp } from '../state/store';
import { formatInit, initDay, initHour, makeInit, maxForecastHour } from './times';

/** First day of HRRR data on NOAA's bucket. */
const ARCHIVE_START = new Date(2014, 6, 30);

/** The calendar works in local dates; these convert to and from UTC calendar days. */
const dayToLocal = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const localToDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function InitPicker() {
  const init = useApp((s) => s.init);
  const manifest = useApp((s) => s.manifest);
  const setInit = useApp((s) => s.setInit);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const ptypeDays = useMemo(() => new Set([...(manifest?.keys() ?? [])].map(initDay)), [manifest]);
  const ptypeHours = useMemo(() => {
    const hours = new Set<number>();
    if (init) for (const key of manifest?.keys() ?? []) if (initDay(key) === initDay(init)) hours.add(initHour(key));
    return hours;
  }, [manifest, init]);
  const latestPtype = useMemo(() => [...(manifest?.keys() ?? [])].sort().at(-1) ?? null, [manifest]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!init) return <div className="init-picker"><button type="button" className="btn" disabled>Loading runs…</button></div>;

  const now = new Date();
  const todayUtc = dayToLocal(now.toISOString().slice(0, 10));
  const day = initDay(init);
  const pick = (d: string, hour: number) =>
    setInit(makeInit(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)), hour));

  return (
    <div className="init-picker" ref={ref}>
      <button type="button" className="btn init-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="label">Model run</span>
        <span className="value">{formatInit(init)}</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Choose a model run">
          <DayPicker
            mode="single"
            required
            selected={dayToLocal(day)}
            defaultMonth={dayToLocal(day)}
            onSelect={(d) => d && pick(localToDay(d), initHour(init))}
            disabled={[{ before: ARCHIVE_START }, { after: todayUtc }]}
            startMonth={ARCHIVE_START}
            endMonth={todayUtc}
            captionLayout="dropdown"
            modifiers={{ ptype: (d) => ptypeDays.has(localToDay(d)) }}
            modifiersClassNames={{ ptype: 'has-ptype' }}
          />
          <div className="hour-title">Initialization hour (UTC)</div>
          <div className="hour-grid">
            {Array.from({ length: 24 }, (_, h) => (
              <button
                key={h}
                type="button"
                className={`hour${h === initHour(init) ? ' selected' : ''}${ptypeHours.has(h) ? ' has-ptype' : ''}`}
                title={`${String(h).padStart(2, '0')}Z · forecasts to ${maxForecastHour(h)} h${ptypeHours.has(h) ? ' · precipitation type available' : ''}`}
                onClick={() => pick(day, h)}
              >
                {String(h).padStart(2, '0')}
              </button>
            ))}
          </div>
          <p className="hint">
            <span className="dot" /> precipitation-type forecast available. 00, 06, 12 and 18Z runs go to 48 h; others to 18 h.
          </p>
          <div className="popover-actions">
            <button type="button" className="btn" disabled={!latestPtype} onClick={() => latestPtype && setInit(latestPtype)}>
              Latest precip-type run
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setInit(await latestHrrrInit());
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Finding…' : 'Latest HRRR run'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
