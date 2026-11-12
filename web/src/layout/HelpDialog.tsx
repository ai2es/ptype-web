import { useApp } from '../state/store';
import { SHORTCUTS } from '../time/useKeyboardShortcuts';

export function HelpDialog() {
  const open = useApp((s) => s.helpOpen);
  const set = useApp((s) => s.set);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onClick={() => set({ helpOpen: false })}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <table className="shortcut-table">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td><kbd>{s.keys}</kbd></td>
                <td>{s.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2>Using the map</h2>
        <p>
          Click anywhere in the forecast domain to open the sounding at that point. Drag the temperature, dewpoint
          or hodograph points to change the profile; the network re-runs in your browser and the probabilities update
          as you drag.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => set({ helpOpen: false })}>Close</button>
      </div>
    </div>
  );
}
