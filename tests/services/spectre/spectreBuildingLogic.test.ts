/// <reference types="jest" />
import {
  findForeignRegionsNeighboringCountry,
  diffAllRegions,
  chunkLines,
  upgradeDtoToSnapshot,
  buildRegionBuildingSnapshot,
  formatBuildingSnapshotLines,
} from '../../../src/services/spectre/spectreBuildingLogic';
import type { RegionBuildingSnapshot } from '../../../src/utils/spectreBuildingStateStore';
import type { BunkerUpgradeDTO } from '../../../src/services/api/WarEraApiClient';

/** Minimal region shape for border tests */
function r(partial: {
  country: string;
  neighbors: string[];
}): Parameters<typeof findForeignRegionsNeighboringCountry>[0] extends Map<infer _K, infer V> ? V : never {
  return partial as never;
}

function makeDto(over: Partial<BunkerUpgradeDTO>): BunkerUpgradeDTO {
  return {
    id: 'x',
    region: 'r1',
    upgradeType: 'bunker',
    level: 1,
    status: 'ok',
    investedMoney: 0,
    investedConcrete: 0,
    investedSteel: 0,
    dependantUsersCount: 0,
    createdAt: '',
    updatedAt: '',
    _v: 0,
    statusChangedAt: '',
    willBeActiveAt: '',
    lastUpgradeAt: '',
    ...over,
  };
}

describe('spectreBuildingLogic', () => {
  describe('findForeignRegionsNeighboringCountry', () => {
    it('includes only foreign regions that neighbor monitored country territory', () => {
      const map = new Map([
        ['a', r({ country: 'C', neighbors: ['b'] })],
        ['b', r({ country: 'D', neighbors: ['a'] })],
        ['c', r({ country: 'C', neighbors: ['d'] })],
        ['d', r({ country: 'C', neighbors: ['c'] })],
      ]);
      const border = findForeignRegionsNeighboringCountry(map, 'C');
      expect(border.sort()).toEqual(['b'].sort());
    });

    it('returns empty when no foreign neighbor', () => {
      const map = new Map([
        ['x', r({ country: 'C', neighbors: ['y'] })],
        ['y', r({ country: 'C', neighbors: ['x'] })],
      ]);
      expect(findForeignRegionsNeighboringCountry(map, 'C')).toEqual([]);
    });

    it('dedupes when multiple monitored regions touch the same foreign region', () => {
      const map = new Map([
        ['a1', r({ country: 'C', neighbors: ['z'] })],
        ['a2', r({ country: 'C', neighbors: ['z'] })],
        ['z', r({ country: 'D', neighbors: ['a1', 'a2'] })],
      ]);
      expect(findForeignRegionsNeighboringCountry(map, 'C').sort()).toEqual(['z']);
    });
  });

  describe('upgradeDtoToSnapshot', () => {
    it('picks typed fields', () => {
      const dto = makeDto({ level: 3, status: 'active', investedMoney: 100 });
      const s = upgradeDtoToSnapshot(dto);
      expect(s.level).toBe(3);
      expect(s.status).toBe('active');
      expect(s.investedMoney).toBe(100);
    });
  });

  describe('diffAllRegions', () => {
    it('detects bunker level change from API snapshots', () => {
      const prev: Record<string, RegionBuildingSnapshot> = {
        r1: {
          bunker: { level: 1, status: 'a', investedMoney: 0, lastUpgradeAt: '1', willBeActiveAt: '1', statusChangedAt: '1' },
          base: null,
        },
      };
      const next: Record<string, RegionBuildingSnapshot> = {
        r1: {
          bunker: { level: 2, status: 'a', investedMoney: 0, lastUpgradeAt: '1', willBeActiveAt: '1', statusChangedAt: '1' },
          base: null,
        },
      };
      const names = new Map([['r1', 'Region One']]);
      const lines = diffAllRegions(prev, next, names);
      expect(lines.some(l => l.includes('**bunker** level: 1 → 2'))).toBe(true);
    });

    it('reports region no longer neighboring monitored country', () => {
      const prev: Record<string, RegionBuildingSnapshot> = {
        gone: { bunker: null, base: null },
      };
      const next: Record<string, RegionBuildingSnapshot> = {};
      const lines = diffAllRegions(prev, next, new Map([['gone', 'Gone']]));
      expect(lines.some(l => l.includes('no longer neighbors monitored country'))).toBe(true);
    });
  });

  describe('buildRegionBuildingSnapshot', () => {
    it('maps bunker and base DTOs', () => {
      const bunker = makeDto({ upgradeType: 'bunker', level: 2 });
      const base = makeDto({ upgradeType: 'base', level: 1 });
      const snap = buildRegionBuildingSnapshot(bunker, base);
      expect(snap.bunker?.level).toBe(2);
      expect(snap.base?.level).toBe(1);
    });
  });

  describe('formatBuildingSnapshotLines', () => {
    it('formats bunker and base slots only', () => {
      const snap: RegionBuildingSnapshot = {
        bunker: {
          level: 2,
          status: 'active',
          investedMoney: 10,
          lastUpgradeAt: '',
          willBeActiveAt: '',
          statusChangedAt: '',
        },
        base: null,
      };
      const lines = formatBuildingSnapshotLines({ z1: snap }, new Map([['z1', 'Zed']]));
      expect(lines.some(l => l.includes('**bunker:** level 2'))).toBe(true);
      expect(lines.some(l => l.includes('**base:** none'))).toBe(true);
      expect(lines.length).toBe(2);
    });
  });

  describe('chunkLines', () => {
    it('splits when over max length', () => {
      const long = 'x'.repeat(1000);
      const chunks = chunkLines([long, long], 1500);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });
});
