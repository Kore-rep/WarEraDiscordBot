/// <reference types="jest" />
import { LegacyBattleFormatter as BattleFormatter } from '../../../src/services/battle/LegacyBattleFormatter';

describe('BattleFormatter', () => {
  let formatter: BattleFormatter;

  beforeEach(() => {
    formatter = new BattleFormatter();
  });

  describe('formatBattleMessage', () => {
    it('should format a basic battle message', () => {
      const battle = createMockBattle('1');
      const countries = new Map([
        ['country1', { name: 'USA', _id: 'country1' }],
        ['country2', { name: 'Canada', _id: 'country2' }],
      ]);
      const regions = new Map([
        ['region1', { name: 'Texas', _id: 'region1' }],
      ]);

      const message = formatter.formatBattleMessage(battle, countries, regions);

      expect(message).toContain('USA');
      expect(message).toContain('Canada');
      expect(message).toContain('Texas');
      expect(message).toContain('https://app.warera.io/battle/1');
      expect(message.length).toBeLessThanOrEqual(2000);
    });

    it('should include change indicator for new battles', () => {
      const battle = createMockBattle('1');
      const message = formatter.formatBattleMessage(
        battle,
        new Map(),
        new Map(),
        'new'
      );

      expect(message).toContain('New Bounty');
    });

    it('should include change indicator for pool increases', () => {
      const battle = createMockBattle('1');
      const message = formatter.formatBattleMessage(
        battle,
        new Map(),
        new Map(),
        'pool_increased'
      );

      expect(message).toContain('Pool Increased');
    });

    it('should include change history', () => {
      const battle = createMockBattle('1');
      const countries = new Map([
        ['country1', { name: 'USA', _id: 'country1' }],
        ['country2', { name: 'Canada', _id: 'country2' }],
      ]);
      const changeHistory = [
        {
          timestamp: new Date('2024-12-11T10:00:00Z'),
          type: 'pool' as const,
          side: 'attacker' as const,
          oldValue: 100,
          newValue: 200,
        },
      ];

      const message = formatter.formatBattleMessage(
        battle,
        countries,
        new Map(),
        'pool_increased',
        changeHistory
      );

      expect(message).toContain('Change History');
      expect(message).toContain('USA Pool increased to 200 from 100');
    });

    it('should stay under 2000 characters', () => {
      const battle = createMockBattle('1');
      
      // Create a very long change history
      const changeHistory = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(`2024-12-11T${String(i % 24).padStart(2, '0')}:00:00Z`),
        type: 'pool' as const,
        side: 'attacker' as const,
        oldValue: 100 + i,
        newValue: 200 + i,
      }));

      const message = formatter.formatBattleMessage(
        battle,
        new Map(),
        new Map(),
        'pool_increased',
        changeHistory
      );

      expect(message.length).toBeLessThanOrEqual(2000);
    });

    it('should truncate country names if too long', () => {
      const battle = createMockBattle('1');
      const countries = new Map([
        ['country1', { name: 'A Very Long Country Name That Exceeds Maximum Length', _id: 'country1' }],
        ['country2', { name: 'Canada', _id: 'country2' }],
      ]);

      const message = formatter.formatBattleMessage(battle, countries, new Map());

      expect(message).toContain('...');
    });

    it('should handle missing country/region data', () => {
      const battle = createMockBattle('1');

      const message = formatter.formatBattleMessage(battle, new Map(), new Map());

      expect(message).toContain('Country country1');
      expect(message).toContain('Country country2');
      expect(message).toContain('Region region1');
    });

    it('should include damage bars', () => {
      const battle = createMockBattle('1');
      const message = formatter.formatBattleMessage(battle, new Map(), new Map());

      // Check for sword and shield emojis in bars
      expect(message).toContain('⚔️');
      expect(message).toContain('🛡️');
    });
  });
});

function createMockBattle(id: string): any {
  return {
    _id: id,
    attacker: {
      country: 'country1',
      region: 'region1',
      wonRoundsCount: 2,
      countryOrders: [],
      muOrders: [],
      damages: 1500000,
      hitCount: 150,
      moneyPer1kDamages: 150,
      moneyPool: 2500000,
    },
    defender: {
      country: 'country2',
      region: 'region1',
      wonRoundsCount: 1,
      countryOrders: [],
      muOrders: [],
      damages: 1200000,
      hitCount: 120,
      moneyPer1kDamages: 200,
      moneyPool: 1800000,
    },
    currentRound: {
      attacker: {
        country: 'country1',
        damages: 50000,
        points: 150,
        lastHits: [],
        hitCount: 50,
      },
      defender: {
        country: 'country2',
        damages: 40000,
        points: 100,
        lastHits: [],
        hitCount: 40,
      },
      live: {
        ticksCount: 10,
        actualTickPoints: 15,
        nextTickAt: new Date().toISOString(),
      },
      _id: 'round1',
      battle: id,
      number: 3,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      __v: 0,
    },
    stats: {
      hitCount: 270,
    },
    war: 'war1',
    rounds: [],
    roundsHistory: [],
    isActive: true,
    isResistance: false,
    roundsToWin: 8,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    __v: 0,
  };
}

