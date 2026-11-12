/** The ptype frame currently on the map, kept outside React for cheap hover lookups. */
import { PTYPE_CLASSES, type PtypeFrame } from '../data/ptype';
import { Lambert, nearestCell } from '../geo/lambert';

let current: { frame: PtypeFrame; mask: Uint8Array | null; proj: Lambert } | null = null;

export function setHoverFrame(frame: PtypeFrame | null, mask: Uint8Array | null) {
  current = frame ? { frame, mask, proj: new Lambert(frame.level.grid) } : null;
}

export interface HoverValue {
  probs: number[];
  u: number;
  /** False where the HRRR has no precipitation (the map is blank there). */
  shown: boolean;
}

export function sampleHover(lon: number, lat: number): HoverValue | null {
  if (!current) return null;
  const cell = nearestCell(current.frame.level.grid, lon, lat, current.proj);
  if (!cell) return null;
  const probs = PTYPE_CLASSES.map((c) => current!.frame.probs[c][cell.index]);
  if (probs.some(Number.isNaN)) return null;
  return { probs, u: current.frame.u[cell.index], shown: !current.mask || current.mask[cell.index] === 1 };
}
