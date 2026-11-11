import aiLogo from '../assets/ai2es.png';
import ciraLogo from '../assets/CIRA.png';
import ncarLogo from '../assets/nsf-ncar.png';
import { useApp } from '../state/store';

export function Header() {
  const set = useApp((s) => s.set);
  return (
    <header className="header">
      <img className="logo logo-ncar" src={ncarLogo} alt="NSF NCAR, operated by UCAR" />
      <div className="title">
        <h1>Precipitation Type Forecasts</h1>
        <p>HRRR soundings classified by an evidential neural network</p>
      </div>
      <div className="header-right">
        <img className="logo" src={ciraLogo} alt="CIRA" />
        <img className="logo" src={aiLogo} alt="AI2ES" />
        <button type="button" className="btn btn-ghost" onClick={() => set({ helpOpen: true })} title="Keyboard shortcuts (?)">
          Shortcuts
        </button>
      </div>
    </header>
  );
}
