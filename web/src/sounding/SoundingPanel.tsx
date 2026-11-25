import { useEffect, useMemo, useRef } from 'react';
import { useApp } from '../state/store';
import { formatUtc, validDate } from '../time/times';
import { applyEdit, resetSounding } from './controller';
import { Hodograph } from './Hodograph';
import { ProbabilityBars } from './ProbabilityBars';
import { profilesEqual } from './profile';
import { SkewT } from './SkewT';
import { soundingStats } from './stats';
import { PointSeries } from './PointSeries';

/** Matches the narrow-screen rule in theme.css, where the panel sits below the map. */
const NARROW = '(max-width: 900px)';

const fmt = (v: number, digits = 0, unit = '') => (Number.isNaN(v) ? '–' : `${v.toFixed(digits)}${unit}`);

export function SoundingPanel() {
  const sounding = useApp((s) => s.sounding);
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const editSigma = useApp((s) => s.editSigma);
  const lockRh = useApp((s) => s.lockRh);
  const set = useApp((s) => s.set);
  const setPoint = useApp((s) => s.setPoint);
  const point = useApp((s) => s.point);
  const panel = useRef<HTMLElement>(null);
  const lastPoint = useRef(point);

  // On a phone the panel is below the map and mostly off the screen, so a tap on the map would seem to do
  // nothing. Bring the panel into view whenever a point is chosen, including one that came with the address.
  useEffect(() => {
    const changed = point !== lastPoint.current;
    lastPoint.current = point;
    const scroller = panel.current?.parentElement;
    // Only the area under the time bar scrolls; scrollIntoView would also nudge the whole page. The jump is
    // immediate: an animated scroll was dropped when the sounding arrived and changed the panel's height.
    if (changed && point && panel.current && scroller && window.matchMedia(NARROW).matches) {
      scroller.scrollTo({ top: panel.current.offsetTop - scroller.offsetTop });
    }
  }, [point]);
  const backToMap = () => panel.current?.parentElement?.scrollTo({ top: 0 });

  const { current, original } = sounding;
  const modified = !!current && !!original && !profilesEqual(current, original);
  const stats = useMemo(() => (current ? soundingStats(current.t, current.heights) : null), [current]);
  const edit = { sigma: editSigma, lockRh };

  return (
    <aside ref={panel} className="sounding-panel" aria-label="Sounding at the selected point">
      <div className="panel-head">
        <div>
          <h2>Sounding</h2>
          {sounding.cell && init && (
            <p className="sub">
              {sounding.cell.lat.toFixed(2)}°N, {Math.abs(sounding.cell.lon).toFixed(2)}°{sounding.cell.lon < 0 ? 'W' : 'E'} ·{' '}
              {formatUtc(validDate(init, fhour))}
            </p>
          )}
        </div>
        {sounding.status !== 'idle' && (
          <div className="panel-actions">
            <button type="button" className="btn btn-ghost small only-narrow" onClick={backToMap}>Back to map</button>
            <button type="button" className="btn btn-ghost small" onClick={() => setPoint(null)}>Close</button>
          </div>
        )}
      </div>

      {sounding.status === 'idle' && (
        <p className="empty">Click a point on the map to see its forecast sounding and precipitation-type probabilities.</p>
      )}
      {(sounding.status === 'unavailable' || sounding.status === 'error') && <p className="empty">{sounding.message}</p>}
      {sounding.status === 'loading' && !current && <p className="empty">Loading sounding…</p>}

      {current && original && (
        <>
          <div className={`edit-bar${modified ? ' is-modified' : ''}`}>
            <span className="edit-state">{modified ? 'Modified' : 'Forecast'}</span>
            <label title="How many neighbouring levels move with the point you drag">
              Drag
              <select value={editSigma} onChange={(e) => set({ editSigma: Number(e.target.value) })}>
                <option value={0}>one level</option>
                <option value={1}>a thin layer</option>
                <option value={2}>a layer</option>
                <option value={4}>a deep layer</option>
              </select>
            </label>
            <label title="Dewpoint follows temperature so relative humidity stays the same">
              <input type="checkbox" checked={lockRh} onChange={() => set({ lockRh: !lockRh })} />
              Keep RH
            </label>
            <button type="button" className="btn small" disabled={!modified} onClick={resetSounding}>Reset</button>
          </div>

          <SkewT profile={current} original={original} modified={modified} edit={edit} onEdit={applyEdit} />
          <p className="key">
            <span className="key-t">Temperature</span>
            <span className="key-td">Dewpoint</span>
            <span className="key-warm">above 0 °C</span>
            <span className="key-cold">below 0 °C</span>
          </p>

          <div className="panel-row">
            <section>
              <h3>Hodograph</h3>
              <Hodograph profile={current} original={original} modified={modified} edit={edit} onEdit={applyEdit} />
            </section>
            <section className="prob-col">
              <h3>Precipitation type probability</h3>
              {sounding.modelError ? (
                <p className="empty">{sounding.modelError}</p>
              ) : (
                <ProbabilityBars prediction={sounding.prediction} original={sounding.originalPrediction} modified={modified} />
              )}
            </section>
          </div>

          {stats && (
            <>
              <h3>Melting and refreezing layers</h3>
              <dl className="stats">
                <div><dt>Melting energy</dt><dd>{fmt(stats.warmArea, 0, ' J/kg')}</dd></div>
                <div><dt>Refreezing energy</dt><dd>{fmt(stats.coldArea, 0, ' J/kg')}</dd></div>
                <div><dt>Melting depth</dt><dd>{fmt(stats.warmThickness, 0, ' m')}</dd></div>
                <div><dt>Refreezing depth</dt><dd>{fmt(stats.coldThickness, 0, ' m')}</dd></div>
                <div><dt>Highest 0 °C level</dt><dd>{fmt(stats.highestCrossing, 0, ' m')}</dd></div>
                <div><dt>Lowest 0 °C level</dt><dd>{fmt(stats.lowestCrossing, 0, ' m')}</dd></div>
                <div><dt title="Warmest temperature below the highest 0 °C level">Warmest aloft</dt><dd>{fmt(stats.maxWarm, 1, ' °C')}</dd></div>
                <div><dt title="Coldest temperature below the highest 0 °C level">Coldest below</dt><dd>{fmt(stats.minCold, 1, ' °C')}</dd></div>
                <div><dt>Surface temperature</dt><dd>{fmt(stats.surfaceTemp, 1, ' °C')}</dd></div>
              </dl>
            </>
          )}
        </>
      )}
      {/* Outside the block above: the frame on screen may have no sounding while other frames of the loop do. */}
      <PointSeries />
    </aside>
  );
}
