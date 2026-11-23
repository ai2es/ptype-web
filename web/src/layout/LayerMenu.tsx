import { BOURGOUIN_URL } from './AboutDialog';
import { useState } from 'react';
import { FIELDS } from '../fields/registry';
import type { PlaceId } from '../map/schools';
import { useApp, type BoundaryId, type LayerStatus } from '../state/store';

const BOUNDARIES: { id: BoundaryId; label: string }[] = [
  { id: 'states', label: 'States' },
  { id: 'counties', label: 'Counties' },
  { id: 'cwas', label: 'NWS forecast offices (CWAs)' },
  { id: 'highways', label: 'Highways' },
  { id: 'cities', label: 'Cities' },
];

const PLACES: { id: PlaceId; label: string; mark: string }[] = [
  { id: 'districts', label: 'Unified school districts', mark: 'mark-district' },
  { id: 'publicSchools', label: 'Public schools', mark: 'mark-public' },
  { id: 'privateSchools', label: 'Private schools', mark: 'mark-private' },
];

const STATUS_TEXT: Record<LayerStatus, string> = {
  loading: 'loading…',
  ok: '',
  unavailable: 'not available for this time',
  error: 'failed to load',
};

function Status({ status }: { status?: LayerStatus }) {
  if (!status || status === 'ok') return null;
  return <span className={`status status-${status}`}>{STATUS_TEXT[status]}</span>;
}

export function LayerMenu() {
  // Start collapsed on phones so the menu does not cover the map.
  const [open, setOpen] = useState(() => window.innerWidth > 900);
  const s = useApp();
  const groups = [...new Set(FIELDS.map((f) => f.group))];

  if (!open) {
    return (
      <button type="button" className="btn layer-toggle" onClick={() => setOpen(true)} aria-expanded="false">
        Layers
      </button>
    );
  }
  return (
    <aside className="layer-menu" aria-label="Map layers">
      <div className="panel-head">
        <h2>Layers</h2>
        <button type="button" className="btn btn-ghost small" onClick={() => setOpen(false)} aria-label="Hide layer menu">Hide</button>
      </div>

      <section>
        <h3>Neural network forecast</h3>
        <label className="check">
          <input type="checkbox" checked={s.showPtype} onChange={() => s.set({ showPtype: !s.showPtype, showBourgouin: s.showPtype ? s.showBourgouin : false })} />
          <span>Most likely precipitation type</span>
          <Status status={s.layerStatus.ptype} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.showUncertainty} onChange={() => s.set({ showUncertainty: !s.showUncertainty })} />
          <span>Epistemic uncertainty contours</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.maskToPrecip} onChange={() => s.set({ maskToPrecip: !s.maskToPrecip })} />
          <span>Only where HRRR composite reflectivity is above 0 dBZ</span>
          {s.maskToPrecip && s.layerStatus['ptype-mask'] && s.layerStatus['ptype-mask'] !== 'ok' && (
            <span className="status status-unavailable">HRRR reflectivity unavailable; showing everywhere</span>
          )}
        </label>
        <label className="range">
          <span>Opacity</span>
          <input
            type="range" min={0.3} max={1} step={0.05} value={s.ptypeOpacity}
            onChange={(e) => s.set({ ptypeOpacity: Number(e.target.value) })}
            aria-label="Precipitation type opacity"
          />
        </label>
      </section>

      <section>
        <h3>Revised Bourgouin method</h3>
        <label className="check">
          <input type="checkbox" checked={s.showBourgouin} onChange={() => s.set({ showBourgouin: !s.showBourgouin, showPtype: s.showBourgouin ? s.showPtype : false })} />
          <span>Most likely precipitation type</span>
          <Status status={s.layerStatus.bourgouin} />
        </label>
        <p className="layer-note">
          Layer-energy diagnosis (<a href={BOURGOUIN_URL} target="_blank" rel="noreferrer">Birk et al. 2021</a>) from the same HRRR profiles, for comparison. Shown in place of the
          network&apos;s; the mask and opacity above apply to both.
        </p>
      </section>

      {groups.map((group) => (
        <section key={group}>
          <h3>HRRR · {group}</h3>
          {FIELDS.filter((f) => f.group === group).map((f) => (
            <label className="check" key={f.id} title={f.note}>
              <input type="checkbox" checked={s.activeFields.includes(f.id)} onChange={() => s.toggleField(f.id)} />
              <span className="swatch" style={{ background: f.swatch }} />
              <span>{f.label}</span>
              {s.activeFields.includes(f.id) && <Status status={s.layerStatus[f.id]} />}
            </label>
          ))}
        </section>
      ))}

      <section>
        <h3>Boundaries and places</h3>
        {BOUNDARIES.map((b) => (
          <label className="check" key={b.id}>
            <input type="checkbox" checked={s.boundaries[b.id]} onChange={() => s.toggleBoundary(b.id)} />
            <span>{b.label}</span>
          </label>
        ))}
      </section>

      <section>
        <h3>Schools</h3>
        {PLACES.map((p) => (
          <label className="check" key={p.id}>
            <input type="checkbox" checked={s.places[p.id]} onChange={() => s.togglePlace(p.id)} />
            <i className={`place-mark ${p.mark}`} />
            <span>{p.label}</span>
          </label>
        ))}
        <p className="layer-note">
          From <a href="https://nces.ed.gov/programs/edge" target="_blank" rel="noreferrer">NCES EDGE</a>. Districts appear from zoom 6 and schools from zoom 8;
          areas served by separate elementary and secondary districts have no outline.
        </p>
      </section>

      <section>
        <h3>Basemap</h3>
        <label className="check">
          <input type="radio" name="basemap" checked={s.basemap === 'plain'} onChange={() => s.set({ basemap: 'plain' })} />
          <span>Plain</span>
        </label>
        <label className="check">
          <input type="radio" name="basemap" checked={s.basemap === 'terrain'} onChange={() => s.set({ basemap: 'terrain' })} />
          <span>Terrain (shading and elevation contours)</span>
        </label>
      </section>
    </aside>
  );
}
