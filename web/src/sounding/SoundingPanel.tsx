import { useMemo } from 'react';
import { useApp } from '../state/store';
import { formatUtc, validDate } from '../time/times';
import { applyEdit, resetSounding } from './controller';
import { Hodograph } from './Hodograph';
import { ProbabilityBars } from './ProbabilityBars';
import { profilesEqual } from './profile';
import { SkewT } from './SkewT';
import { soundingStats } from './stats';

const fmt = (v: number, digits = 0, unit = '') => (Number.isNaN(v) ? '–' : `${v.toFixed(digits)}${unit}`);

export function SoundingPanel() {
  const sounding = useApp((s) => s.sounding);
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);
  const editSigma = useApp((s) => s.editSigma);
  const lockRh = useApp((s) => s.lockRh);
  const set = useApp((s) => s.set);
  const setPoint = useApp((s) => s.setPoint);

  const { current, original } = sounding;
  const modified = !!current && !!original && !profilesEqual(current, original);
  const stats = useMemo(() => (current ? soundingStats(current.t, current.heights) : null), [current]);
  const edit = { sigma: editSigma, lockRh };

  return (
    <aside className="sounding-panel" aria-label="Sounding at the selected point">
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
          <button type="button" className="btn btn-ghost small" onClick={() => setPoint(null)}>Close</button>
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
            <span className="edit-state">{modified ? 'Modified sounding' : 'Forecast sounding'}</span>
            <button type="button" className="btn small" disabled={!modified} onClick={resetSounding}>Reset</button>
          </div>
          <div className="edit-options">
            <label title="How many neighbouring levels move with the point you drag">
              Drag affects
              <select value={editSigma} onChange={(e) => set({ editSigma: Number(e.target.value) })}>
                <option value={0}>one level</option>
                <option value={1}>a thin layer</option>
                <option value={2}>a layer</option>
                <option value={4}>a deep layer</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={lockRh} onChange={() => set({ lockRh: !lockRh })} />
              <span>Keep relative humidity</span>
            </label>
          </div>

          <SkewT profile={current} original={original} modified={modified} edit={edit} onEdit={applyEdit} />
          <p className="key">
            <span className="key-t">Temperature</span>
            <span className="key-td">Dewpoint</span>
            <span className="key-warm">above 0 °C</span>
            <span className="key-cold">below 0 °C</span>
          </p>

          <h3>Hodograph</h3>
          <Hodograph profile={current} original={original} modified={modified} edit={edit} onEdit={applyEdit} />

          <h3>Precipitation type probability</h3>
          {sounding.modelError ? (
            <p className="empty">{sounding.modelError}</p>
          ) : (
            <ProbabilityBars prediction={sounding.prediction} original={sounding.originalPrediction} modified={modified} />
          )}

          {stats && (
            <>
              <h3>Melting and refreezing layers</h3>
              <dl className="stats">
                <dt>Melting energy</dt><dd>{fmt(stats.warmArea, 0, ' J/kg')}</dd>
                <dt>Refreezing energy</dt><dd>{fmt(stats.coldArea, 0, ' J/kg')}</dd>
                <dt>Melting layer depth</dt><dd>{fmt(stats.warmThickness, 0, ' m')}</dd>
                <dt>Refreezing layer depth</dt><dd>{fmt(stats.coldThickness, 0, ' m')}</dd>
                <dt>Highest 0 °C level</dt><dd>{fmt(stats.highestCrossing, 0, ' m')}</dd>
                <dt>Lowest 0 °C level</dt><dd>{fmt(stats.lowestCrossing, 0, ' m')}</dd>
                <dt>Warmest below top 0 °C</dt><dd>{fmt(stats.maxWarm, 1, ' °C')}</dd>
                <dt>Coldest below top 0 °C</dt><dd>{fmt(stats.minCold, 1, ' °C')}</dd>
                <dt>Surface temperature</dt><dd>{fmt(stats.surfaceTemp, 1, ' °C')}</dd>
              </dl>
            </>
          )}
        </>
      )}
    </aside>
  );
}
