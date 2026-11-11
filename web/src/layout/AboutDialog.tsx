import { useApp } from '../state/store';

export const PAPER_URL = 'https://doi.org/10.1175/WAF-D-25-0237.1';

const EVIDENTIAL_URL = 'https://doi.org/10.1175/AIES-D-23-0093.1';

export function AboutDialog() {
  const open = useApp((s) => s.aboutOpen);
  const set = useApp((s) => s.set);
  if (!open) return null;
  const close = () => set({ aboutOpen: false });
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="About the algorithm" onClick={(e) => e.stopPropagation()}>
        <h2>About the algorithm</h2>
        <p>
          The evidential neural network (ENN) diagnoses winter precipitation type from the vertical profile of
          temperature, dewpoint and wind in the lowest 5 km, and was trained on quality-controlled, crowd-sourced mPING
          reports paired with NOAA Rapid Refresh analysis profiles. Instead of a single answer, one pass of the network
          gives calibrated probabilities of rain, snow, ice pellets and freezing rain together with an epistemic
          uncertainty, at the cost of a standard neural network. Against held-out mPING reports from June 2020 to June
          2022 it had a higher success ratio than area-based methods for freezing rain and ice pellets and was
          comparable or better for rain and snow, while detecting fewer freezing rain events because many of those
          environments are truly ambiguous.
        </p>
        <p className="citation">
          Becker, C., D. J. Gagne, J. Demuth, J. S. Schreck, J. Radford, G. Gantos, E. Kim, D. Kimpara, S. Reiner,
          J. Willson, and C. D. Wirz, 2026: Winter precipitation-type diagnosis and uncertainty quantification with a
          physically consistent machine learning method. <i>Weather and Forecasting</i>, <b>41</b>, 2051–2068,{' '}
          <a href={PAPER_URL} target="_blank" rel="noreferrer">{PAPER_URL}</a>.
        </p>
        <p className="citation">
          The evidential method: Schreck, J. S., D. J. Gagne, C. Becker, and Coauthors, 2024: Evidential deep learning:
          Enhancing predictive uncertainty estimation for Earth system science applications.{' '}
          <i>Artificial Intelligence for the Earth Systems</i>, <b>3</b> (4),{' '}
          <a href={EVIDENTIAL_URL} target="_blank" rel="noreferrer">{EVIDENTIAL_URL}</a>.
        </p>
        <h2>Code</h2>
        <ul className="link-list">
          <li>
            <a href="https://github.com/ai2es/miles-guess" target="_blank" rel="noreferrer">MILES GUESS</a>: the
            evidential deep learning library the network is built with
          </li>
          <li>
            <a href="https://github.com/ai2es/ptype-physical" target="_blank" rel="noreferrer">ptype-physical</a>: data
            processing, training and evaluation for the precipitation-type model
          </li>
        </ul>
        <button type="button" className="btn btn-primary" onClick={close}>Close</button>
      </div>
    </div>
  );
}
