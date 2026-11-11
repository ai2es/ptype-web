/** Loads the sounding for the selected point and runs the network whenever the profile changes. */
import { useEffect } from 'react';
import { SoundingUnavailable, readSounding } from '../data/soundings';
import { predict } from '../model/ptypeModel';
import { useApp } from '../state/store';
import { cloneProfile, type Profile } from './profile';

let loadGen = 0;
let predictGen = 0;

async function runModel(profile: Profile, isOriginal: boolean) {
  const gen = ++predictGen;
  try {
    const prediction = await predict(profile);
    if (gen !== predictGen) return;
    useApp.getState().setSounding(
      isOriginal ? { prediction, originalPrediction: prediction, modelError: undefined } : { prediction, modelError: undefined },
    );
  } catch (err) {
    console.error(err);
    if (gen === predictGen) useApp.getState().setSounding({ modelError: 'The model could not be loaded.' });
  }
}

/** Replace the working profile with an edited one and re-run the network. */
export function applyEdit(profile: Profile) {
  useApp.getState().setSounding({ current: profile });
  void runModel(profile, false);
}

export function resetSounding() {
  const { original, originalPrediction } = useApp.getState().sounding;
  if (!original) return;
  predictGen++;
  useApp.getState().setSounding({ current: cloneProfile(original), prediction: originalPrediction });
}

export function useSoundingLoader() {
  const point = useApp((s) => s.point);
  const init = useApp((s) => s.init);
  const fhour = useApp((s) => s.fhour);

  useEffect(() => {
    const { setSounding, set } = useApp.getState();
    const gen = ++loadGen;
    if (!point || !init) {
      set({ sounding: { status: 'idle' } });
      return;
    }
    // Keep showing the previous profile while the next one loads (smoother when animating).
    setSounding({ status: 'loading', message: undefined });
    readSounding(init, fhour, point.lon, point.lat)
      .then((res) => {
        if (gen !== loadGen) return;
        set({
          sounding: {
            status: 'ready',
            cell: { lon: res.lon, lat: res.lat },
            original: res.profile,
            current: cloneProfile(res.profile),
          },
        });
        void runModel(res.profile, true);
      })
      .catch((err) => {
        if (gen !== loadGen) return;
        if (!(err instanceof SoundingUnavailable)) console.error(err);
        set({
          sounding: {
            status: err instanceof SoundingUnavailable ? 'unavailable' : 'error',
            message: err instanceof SoundingUnavailable ? err.message : 'The sounding could not be loaded.',
          },
        });
      });
  }, [point, init, fhour]);
}
