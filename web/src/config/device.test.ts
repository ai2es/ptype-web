import { describe, expect, it } from 'vitest';
import { isLowMemoryDevice } from './device';

const nav = (platform: string, maxTouchPoints: number, userAgent = '', deviceMemory?: number) => ({ platform, maxTouchPoints, userAgent, deviceMemory });

describe('low-memory device detection', () => {
  it('treats iPads as low memory, including in desktop-website mode', () => {
    expect(isLowMemoryDevice(nav('iPad', 5))).toBe(true);
    expect(isLowMemoryDevice(nav('MacIntel', 5))).toBe(true);
    expect(isLowMemoryDevice(nav('iPhone', 5))).toBe(true);
  });

  it('treats a Mac or PC without reported memory as a desktop', () => {
    expect(isLowMemoryDevice(nav('MacIntel', 0))).toBe(false);
    expect(isLowMemoryDevice(nav('Win32', 0, 'Windows', 8))).toBe(false);
  });

  it('uses reported memory and Android where available', () => {
    expect(isLowMemoryDevice(nav('Win32', 0, 'Windows', 4))).toBe(true);
    expect(isLowMemoryDevice(nav('Linux armv8l', 5, 'Mozilla/5.0 (Linux; Android 14)'))).toBe(true);
  });
});
