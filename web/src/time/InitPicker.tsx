import { useEffect, useMemo, useRef, useState } from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { latestHrrrInit } from '../state/startup';
import { useApp } from '../state/store';
import { formatInit, initDay, initHour, makeInit, maxForecastHour } from './times';
import { MAX_LEAD, trendFrames, validIso, validTimes } from './trend';

/** First day of HRRR data on NOAA's bucket. */
const ARCHIVE_START = new Date(2014, 6, 30);

/** The calendar works in local dates; these convert to and from UTC calendar days. */
const dayToLocal = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const localToDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Chooses the time the loop is built around: the model run in run mode, the valid time in trend mode.
 * Both are a UTC day and hour, so one calendar and hour grid serves both.
 */
export function InitPicker() {
  const mode = useApp((s) => s.mode);
  const run = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const manifest = useApp((s) => s.manifest);
  const setInit = useApp((s) => s.setInit);
  const setValid = useApp((s) => s.setValid);
  const trend = mode === 'trend';
  // The time shown and picked: the run, or the time its forecast on screen is valid.
  const init = run && trend ? validIso(run, fhour) : run;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Times to mark: runs with a precipitation-type forecast, or valid times that one of them covers.
  const marked = useMemo(() => (trend ? [...validTimes(manifest)] : [...(manifest?.keys() ?? [])]), [manifest, trend]);
  const ptypeDays = useMemo(() => new Set(marked.map(initDay)), [marked]);
  const ptypeHours = useMemo(() => {
    const hours = new Set<number>();
    if (init) for (const key of marked) if (initDay(key) === initDay(init)) hours.add(initHour(key));
    return hours;
  }, [marked, init]);
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

  // Runs exist up to now; their forecasts are valid up to 48 h later.
  const last = new Date(Date.now() + (trend ? MAX_LEAD * 3600_000 : 0));
  const todayUtc = dayToLocal(last.toISOString().slice(0, 10));
  const day = initDay(init);
  const pick = (d: string, hour: number) =>
    (trend ? setValid : setInit)(makeInit(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8, 10)), hour));

  return (
    <div className="init-picker" ref={ref}>
      <button type="button" className="btn init-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="label">{trend ? 'Valid time' : 'Model run'}</span>
        <span className="value">{formatInit(init)}</span>
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={trend ? 'Choose a valid time' : 'Choose a model run'}>
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
          <div className="hour-title">{trend ? 'Valid hour (UTC)' : 'Initialization hour (UTC)'}</div>
          <div className="hour-grid">
            {Array.from({ length: 24 }, (_, h) => (
              <button
                key={h}
                type="button"
                className={`hour${h === initHour(init) ? ' selected' : ''}${ptypeHours.has(h) ? ' has-ptype' : ''}`}
                title={`${String(h).padStart(2, '0')}Z${trend ? '' : ` · forecasts to ${maxForecastHour(h)} h`}${ptypeHours.has(h) ? ' · precipitation type available' : ''}`}
                disabled={trend && trendFrames(makeInit(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), h)).length === 0}
                onClick={() => pick(day, h)}
              >
                {String(h).padStart(2, '0')}
              </button>
            ))}
          </div>
          <p className="hint">
            <span className="dot" /> precipitation-type forecast available.{' '}
            {trend
              ? 'The loop shows every run valid at this time: hourly runs from 18 h ahead, and 00, 06, 12 and 18Z runs from 48 h ahead.'
              : '00, 06, 12 and 18Z runs go to 48 h; others to 18 h.'}
          </p>
          <div className="popover-actions">
            <button type="button" className="btn" disabled={!latestPtype} onClick={() => latestPtype && (trend ? setValid : setInit)(latestPtype)}>
              {trend ? 'Latest precip-type analysis' : 'Latest precip-type run'}
            </button>
            {!trend && <button
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
            </button>}
          </div>
        </div>
      )}
    </div>
  );
}
