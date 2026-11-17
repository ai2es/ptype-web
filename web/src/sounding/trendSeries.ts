/**
 * The network's output at one point from every run of a trend loop, for the chart in the sounding panel.
 *
 * Each value comes from the run's stored sounding at that point put through the network, exactly as the
 * panel's probability bars do, so the chart and the bars agree. That costs one small range request per
 * run and does not depend on which map frames happen to be loaded.
 */
import type { Manifest } from '../data/manifest';
import { SoundingUnavailable, readSounding } from '../data/soundings';
import type { Prediction } from '../model/evidential';
import { predict } from '../model/ptypeModel';
import type { Frame } from '../time/trend';

/** A run's forecast at the point: null when the run has no stored forecast there, undefined while loading. */
export type TrendValue = Prediction | null | undefined;

/** Runs read at once: enough to fill the chart quickly without starving the map of connections. */
const CONCURRENT = 4;

/**
 * Read the point's forecast from each frame, calling `onValue` as each arrives (in no fixed order).
 * `cancelled` is polled so an abandoned request stops starting new reads.
 */
export async function loadTrendSeries(
  frames: Frame[],
  manifest: Manifest | null,
  lon: number,
  lat: number,
  onValue: (frame: Frame, value: Prediction | null) => void,
  cancelled: () => boolean = () => false,
  read = readSounding,
  run = predict,
): Promise<void> {
  const queue = [...frames];
  const worker = async () => {
    for (let frame = queue.shift(); frame && !cancelled(); frame = queue.shift()) {
      const entry = manifest?.get(frame.init);
      let value: Prediction | null = null;
      if (entry?.forecastHours.includes(frame.fhour)) {
        try {
          value = await run((await read(entry, frame.fhour, lon, lat)).profile);
        } catch (err) {
          // A missing sounding is a gap in the chart, like a run with no forecast; anything else is worth a log line.
          if (!(err instanceof SoundingUnavailable)) console.error('trend sounding failed:', err);
        }
      }
      if (!cancelled()) onValue(frame, value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENT, queue.length) }, worker));
}
