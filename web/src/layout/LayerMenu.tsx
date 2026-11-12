import { useState } from 'react';
import { FIELDS } from '../fields/registry';
import { useApp, type BoundaryId, type LayerStatus } from '../state/store';

const BOUNDARIES: { id: BoundaryId; label: string }[] = [
  { id: 'states', label: 'States' },
  { id: 'counties', label: 'Counties' },
  { id: 'cwas', label: 'NWS forecast offices (CWAs)' },
  { id: 'highways', label: 'Highways' },
  { id: 'cities', label: 'Cities' },
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
          <input type="checkbox" checked={s.showPtype} onChange={() => s.set({ showPtype: !s.showPtype })} />
          <span>Most likely precipitation type</span>
          <Status status={s.layerStatus.ptype} />
        </label>
        <label className="check">
          <input type="checkbox" checked={s.showUncertainty} onChange={() => s.set({ showUncertainty: !s.showUncertainty })} />
          <span>Epistemic uncertainty contours</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.maskToPrecip} onChange={() => s.set({ maskToPrecip: !s.maskToPrecip })} />
          <span>Only where the HRRR has precipitation</span>
          {s.maskToPrecip && s.layerStatus['ptype-mask'] && s.layerStatus['ptype-mask'] !== 'ok' && (
            <span className="status status-unavailable">HRRR mask unavailable; showing everywhere</span>
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
    </aside>
  );
}
