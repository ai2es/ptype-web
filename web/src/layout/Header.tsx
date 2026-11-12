import aiLogo from '../assets/ai2es.png';
import ciraLogo from '../assets/CIRA.png';
import ncarLogo from '../assets/nsf-ncar.png';
import { useApp } from '../state/store';
import { PAPER_URL } from './AboutDialog';

export function Header() {
  const set = useApp((s) => s.set);
  return (
    <header className="header">
      <img className="logo logo-ncar" src={ncarLogo} alt="NSF NCAR, operated by UCAR" />
      <div className="title">
        <h1>
          ENN Precipitation Type Forecasts
          <button type="button" className="about-button" onClick={() => set({ aboutOpen: true })} title="About the algorithm" aria-label="About the algorithm">
            ?
          </button>
        </h1>
        <p>
          <a href={PAPER_URL} target="_blank" rel="noreferrer">
            Becker et al. (2026), <i>Weather and Forecasting</i>, doi:10.1175/WAF-D-25-0237.1
          </a>
        </p>
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
