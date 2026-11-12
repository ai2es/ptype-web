import { useEffect } from 'react';
import { AboutDialog } from './layout/AboutDialog';
import { Header } from './layout/Header';
import { HelpDialog } from './layout/HelpDialog';
import { LayerMenu } from './layout/LayerMenu';
import { Legend } from './layout/Legend';
import { MapView } from './map/MapView';
import { useSoundingLoader } from './sounding/controller';
import { SoundingPanel } from './sounding/SoundingPanel';
import { startApp } from './state/startup';
import { useApp } from './state/store';
import { TimeBar } from './time/TimeBar';
import { useAnimation } from './time/useAnimation';
import { useKeyboardShortcuts } from './time/useKeyboardShortcuts';

let started = false;

export function App() {
  useEffect(() => {
    if (started) return;
    started = true;
    void startApp();
  }, []);
  useAnimation();
  useKeyboardShortcuts();
  useSoundingLoader();
  const manifestError = useApp((s) => s.manifestError);

  return (
    <div className="app">
      <Header />
      <TimeBar />
      {manifestError && (
        <div className="banner" role="status">
          The list of precipitation-type forecasts could not be loaded, so only HRRR fields are shown. ({manifestError})
        </div>
      )}
      <main className="main">
        <div className="map-area">
          <MapView />
          <LayerMenu />
          <Legend />
        </div>
        <SoundingPanel />
      </main>
      <HelpDialog />
      <AboutDialog />
    </div>
  );
}
