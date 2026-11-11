import { PTYPE_STYLES, UNCERTAINTY_COLOR } from '../config/ptypeStyle';
import type { Prediction } from '../model/evidential';

interface Props {
  prediction?: Prediction;
  original?: Prediction;
  modified: boolean;
}

export function ProbabilityBars({ prediction, original, modified }: Props) {
  const rows = [
    ...PTYPE_STYLES.map((s, k) => ({ label: s.label, color: s.color, value: prediction?.probs[k], orig: original?.probs[k] })),
    { label: 'Epistemic uncertainty', color: UNCERTAINTY_COLOR, value: prediction?.u, orig: original?.u },
  ];
  return (
    <div className={`prob-bars${modified ? ' modified' : ''}`} role="table" aria-label="Precipitation type probabilities">
      {rows.map((r) => (
        <div className="prob-row" role="row" key={r.label}>
          <span className="prob-label" role="cell">{r.label}</span>
          <span className="prob-track" role="cell">
            <span className="prob-fill" style={{ width: `${(r.value ?? 0) * 100}%`, background: r.color }} />
            {modified && r.orig !== undefined && (
              <span className="prob-orig" style={{ left: `${r.orig * 100}%` }} title={`Original forecast: ${Math.round(r.orig * 100)}%`} />
            )}
          </span>
          <span className="prob-value" role="cell">{r.value === undefined ? '–' : `${Math.round(r.value * 100)}%`}</span>
        </div>
      ))}
      {modified && <p className="hint">Tick marks show the original forecast.</p>}
    </div>
  );
}
