import { beforeEach, describe, expect, it } from 'vitest';
import { parseManifest } from '../data/manifest';
import { frameIndex, loopFrames, useApp } from '../state/store';
import { isKept, nearestFrame, trendFrames, validIso, validTimes } from './trend';

const LATER = new Date('2030-01-01T00:00Z');

describe('trendFrames', () => {
  it('has 24 runs for a past valid time, longest lead first and the analysis last', () => {
    const frames = trendFrames('2023-12-26T12:00Z', LATER);
    expect(frames.map((f) => f.fhour)).toEqual([48, 42, 36, 30, 24, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(frames[0]).toEqual({ init: '2023-12-24T12:00Z', fhour: 48 });
    expect(frames.at(-1)).toEqual({ init: '2023-12-26T12:00Z', fhour: 0 });
    for (const f of frames) expect(validIso(f.init, f.fhour)).toBe('2023-12-26T12:00Z');
  });

  it('takes leads beyond 18 h only from the 00/06/12/18 UTC runs', () => {
    const frames = trendFrames('2023-12-26T13:00Z', LATER);
    expect(frames.filter((f) => f.fhour > 18).map((f) => f.fhour)).toEqual([43, 37, 31, 25, 19]);
    expect(frames).toHaveLength(24);
    for (const f of frames.filter((g) => g.fhour > 18)) expect(Number(f.init.slice(11, 13)) % 6).toBe(0);
  });

  it('leaves out runs that have not started yet', () => {
    const frames = trendFrames('2023-12-26T12:00Z', new Date('2023-12-26T02:30Z'));
    expect(frames.at(-1)).toEqual({ init: '2023-12-26T02:00Z', fhour: 10 });
    expect(trendFrames('2023-12-26T13:00Z', new Date('2023-12-24T00:00Z'))).toEqual([]);
  });
});

describe('validTimes', () => {
  it('lists every time a p-type run covers, once', () => {
    const manifest = parseManifest({ inits: [{ init: '2023-12-26T00:00Z', forecast_hours: [0, 1, 2] }, { init: '2023-12-26T01:00Z', forecast_hours: [0, 1, 2] }] });
    expect([...validTimes(manifest)].sort()).toEqual(['2023-12-26T00:00Z', '2023-12-26T01:00Z', '2023-12-26T02:00Z', '2023-12-26T03:00Z']);
    expect(validTimes(null).size).toBe(0);
  });
});

describe('isKept / nearestFrame', () => {
  it('covers a whole run, or one forecast hour of it', () => {
    expect(isKept([{ init: 'a' }], 'a', 7)).toBe(true);
    expect(isKept([{ init: 'a', fhour: 6 }], 'a', 7)).toBe(false);
    expect(isKept([{ init: 'a', fhour: 6 }, { init: 'b', fhour: 7 }], 'b', 7)).toBe(true);
    expect(isKept([], 'a', 0)).toBe(false);
  });
  it('finds the nearest lead', () => {
    const frames = trendFrames('2023-12-26T12:00Z', LATER);
    expect(frames[nearestFrame(frames, 20)].fhour).toBe(18);
    expect(frames[nearestFrame(frames, 22)].fhour).toBe(24);
    expect(nearestFrame([], 3)).toBe(-1);
  });
});

describe('stepping in the store', () => {
  beforeEach(() => useApp.setState({ mode: 'run', init: '2023-12-26T00:00Z', fhour: 12, playing: false }));
  const frame = () => ({ init: useApp.getState().init, fhour: useApp.getState().fhour });

  it('run mode steps forecast hours and wraps', () => {
    useApp.getState().stepFhour(1);
    expect(frame()).toEqual({ init: '2023-12-26T00:00Z', fhour: 13 });
    useApp.getState().setFrame(48);
    useApp.getState().stepFhour(1);
    expect(frame()).toEqual({ init: '2023-12-26T00:00Z', fhour: 0 });
  });

  it('switching mode keeps the frame; trend mode steps runs with the valid time fixed', () => {
    useApp.getState().setMode('trend');
    expect(frame()).toEqual({ init: '2023-12-26T00:00Z', fhour: 12 });
    useApp.getState().stepFhour(1);
    expect(frame()).toEqual({ init: '2023-12-26T01:00Z', fhour: 11 });
    useApp.getState().stepFhour(-2);
    expect(frame()).toEqual({ init: '2023-12-25T23:00Z', fhour: 13 });
    useApp.getState().setFrame(0);
    expect(frame()).toEqual({ init: '2023-12-24T12:00Z', fhour: 48 });
    useApp.getState().stepFhour(-1); // wraps to the analysis
    expect(frame()).toEqual({ init: '2023-12-26T12:00Z', fhour: 0 });
    useApp.getState().stepFhour(1); // and back to the longest lead
    expect(frame()).toEqual({ init: '2023-12-24T12:00Z', fhour: 48 });
    const frames = loopFrames(useApp.getState());
    expect(frames).toHaveLength(24);
    expect(frameIndex(frames, useApp.getState())).toBe(0);
    useApp.getState().setMode('run');
    expect(frame()).toEqual({ init: '2023-12-24T12:00Z', fhour: 48 });
  });

  it('setValid keeps the lead where that run exists, else takes the nearest', () => {
    useApp.getState().setMode('trend');
    useApp.getState().setValid('2023-12-27T06:00Z');
    expect(frame()).toEqual({ init: '2023-12-26T18:00Z', fhour: 12 });
    useApp.getState().setFrame(1); // F42
    useApp.getState().setValid('2023-12-27T07:00Z'); // leads beyond 18 h there are 43, 37, ...
    expect(frame()).toEqual({ init: '2023-12-25T12:00Z', fhour: 43 });
    useApp.getState().stepInit(-1);
    expect(validIso(frame().init!, frame().fhour)).toBe('2023-12-27T06:00Z');
  });
});

describe('leadLabels', () => {
  it('thins the labels where frames are six hours apart', async () => {
    const { leadLabels } = await import('./trend');
    expect(leadLabels(trendFrames('2023-12-26T12:00Z', LATER).map((f) => f.fhour)).map((l) => l.text)).toEqual(['48', '36', '24', '18', '12', '6', '0']);
    expect(leadLabels(trendFrames('2023-12-26T13:00Z', LATER).map((f) => f.fhour)).map((l) => l.text)).toEqual(['43', '18', '12', '6', '0']);
  });
});
