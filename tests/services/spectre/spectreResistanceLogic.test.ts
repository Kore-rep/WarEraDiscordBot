/// <reference types="jest" />
import {
  buildCountryResistanceSnapshots,
  diffResistanceCountry,
  formatResistanceSnapshotLines,
  RESISTANCE_ALERT_RATIO,
  RESISTANCE_LARGE_CHANGE_DELTA,
} from '../../../src/services/spectre/spectreResistanceLogic';
import type { RegionResistanceSnapshot } from '../../../src/utils/spectreBuildingStateStore';

describe('spectreResistanceLogic', () => {
  it('formatResistanceSnapshotLines lists ratio and values', () => {
    const snaps: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 90, resistanceMax: 100, ratio: 0.9 },
    };
    const lines = formatResistanceSnapshotLines(snaps, new Map([['r1', 'Alpha']]));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('90.0%');
    expect(lines[0]).toContain('90/100');
    expect(lines[0]).toContain('Alpha');
  });

  it('reports when crossing into >=90%', () => {
    const prev: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 50, resistanceMax: 100, ratio: 0.5 },
    };
    const next: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 92, resistanceMax: 100, ratio: 0.92 },
    };
    const lines = diffResistanceCountry(prev, next, new Map([['r1', 'A']]));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('92.0%');
  });

  it('does not repeat identical ratio above threshold', () => {
    const snap: RegionResistanceSnapshot = { resistance: 95, resistanceMax: 100, ratio: 0.95 };
    const lines = diffResistanceCountry({ r1: snap }, { r1: snap }, new Map([['r1', 'A']]));
    expect(lines).toEqual([]);
  });

  it('reports change while above 90%', () => {
    const prev: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 90, resistanceMax: 100, ratio: 0.9 },
    };
    const next: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 95, resistanceMax: 100, ratio: 0.95 },
    };
    const lines = diffResistanceCountry(prev, next, new Map([['r1', 'A']]));
    expect(lines.length).toBe(1);
  });

  it('reports drop below 90%', () => {
    const prev: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 95, resistanceMax: 100, ratio: 0.95 },
    };
    const next: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 80, resistanceMax: 100, ratio: 0.8 },
    };
    const lines = diffResistanceCountry(prev, next, new Map([['r1', 'A']]));
    expect(lines.some(l => l.includes('below 90%'))).toBe(true);
  });

  it('reports when ratio moves more than 10% between polls (below 90%)', () => {
    const prev: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 40, resistanceMax: 100, ratio: 0.4 },
    };
    const next: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 56, resistanceMax: 100, ratio: 0.56 },
    };
    const lines = diffResistanceCountry(prev, next, new Map([['r1', 'A']]));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('40.0%');
    expect(lines[0]).toContain('56.0%');
    expect(lines[0]).toContain('>10%');
  });

  it('does not report sub-10% moves when both stays below 90%', () => {
    const prev: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 50, resistanceMax: 100, ratio: 0.5 },
    };
    const next: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 58, resistanceMax: 100, ratio: 0.58 },
    };
    const lines = diffResistanceCountry(prev, next, new Map([['r1', 'A']]));
    expect(lines).toEqual([]);
  });

  it('does not duplicate 90% cross with large-delta line', () => {
    const prev: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 80, resistanceMax: 100, ratio: 0.8 },
    };
    const next: Record<string, RegionResistanceSnapshot> = {
      r1: { resistance: 95, resistanceMax: 100, ratio: 0.95 },
    };
    const lines = diffResistanceCountry(prev, next, new Map([['r1', 'A']]));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain('95.0%');
    expect(lines[0]).not.toContain('>10%');
  });

  it('buildCountryResistanceSnapshots skips zero max', () => {
    const regions = new Map([
      ['a', { _id: 'a', country: 'C', resistance: 1, resistanceMax: 0 } as never],
      ['b', { _id: 'b', country: 'C', resistance: 9, resistanceMax: 10, name: 'B' } as never],
    ]);
    const out = buildCountryResistanceSnapshots(regions, 'C');
    expect(out.a).toBeUndefined();
    expect(out.b.ratio).toBeCloseTo(0.9, 5);
    expect(RESISTANCE_ALERT_RATIO).toBe(0.9);
    expect(RESISTANCE_LARGE_CHANGE_DELTA).toBe(0.1);
  });
});
