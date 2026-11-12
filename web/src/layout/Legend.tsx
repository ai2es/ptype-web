import { useEffect, useRef } from 'react';
import { LEGEND_MIN_PROB, PTYPE_STYLES } from '../config/ptypeStyle';
import { FIELD_BY_ID } from '../fields/registry';
import { useApp } from '../state/store';
import { makeColorBar } from '../vendor/apgl';

function ColorBar({ fieldId }: { fieldId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const def = FIELD_BY_ID.get(fieldId);
  useEffect(() => {
    const style = def?.style;
    if (!ref.current || !style || !('colorbar' in style) || !style.colorbar) return;
    const svg = makeColorBar(style.cmap, {
      label: style.colorbar.label,
      ticks: style.colorbar.ticks,
      orientation: 'horizontal',
      fontface: 'Poppins',
      size_long: 240,
      size_short: 62,
      ticklabelsize: 10,
    });
    ref.current.replaceChildren(svg);
  }, [def]);
  return <div ref={ref} className="colorbar" />;
}

export function Legend() {
  const showPtype = useApp((s) => s.showPtype);
  const activeFields = useApp((s) => s.activeFields);
  const firstBin = Math.round(LEGEND_MIN_PROB * 10);
  const bars = activeFields.filter((id) => {
    const style = FIELD_BY_ID.get(id)?.style;
    return style && 'colorbar' in style && style.colorbar;
  });
  if (!showPtype && bars.length === 0 && !activeFields.includes('hrrr_ptype')) return null;

  return (
    <div className="legend" aria-label="Map legend">
      {showPtype && (
        <div className="legend-block">
          <div className="legend-title">Most likely type · probability</div>
          {PTYPE_STYLES.map((s) => (
            <div className="legend-row" key={s.id}>
              <span className="legend-name">{s.label}</span>
              <span className="ramp">
                {s.ramp.slice(firstBin).map((c) => (
                  <span key={c} style={{ background: c }} />
                ))}
              </span>
            </div>
          ))}
          <div className="legend-row legend-scale">
            <span className="legend-name" />
            <span className="ramp-scale">
              <span>{Math.round(LEGEND_MIN_PROB * 100)}%</span>
              <span>100%</span>
            </span>
          </div>
        </div>
      )}
      {activeFields.includes('hrrr_ptype') && (
        <div className="legend-block">
          <div className="legend-title">HRRR categorical type</div>
          <div className="legend-chips">
            {PTYPE_STYLES.map((s) => (
              <span key={s.id}><i style={{ background: s.ramp[8] }} />{s.label}</span>
            ))}
          </div>
        </div>
      )}
      {bars.map((id) => (
        <ColorBar key={id} fieldId={id} />
      ))}
    </div>
  );
}
