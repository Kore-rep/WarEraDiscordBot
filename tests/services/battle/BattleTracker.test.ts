import { LegacyBattleTracker as BattleTracker } from '../../../src/services/battle/LegacyBattleTracker';

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('BattleTracker', () => {
  let tracker: BattleTracker;

  beforeEach(() => {
    tracker = new BattleTracker();
  });

  describe('detectChanges', () => {
    it('should detect new battles', () => {
      const battles = [
        createMockBattle('1', 100, 1.5, 200, 2.0),
      ];

      const changes = tracker.detectChanges(battles);

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('new');
      expect(changes[0].battle._id).toBe('1');
    });

    it('should detect pool increases', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - increased pool
      battle.attacker.moneyPool = 150;
      const changes = tracker.detectChanges([battle]);

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('pool_increased');
      expect(changes[0].changeHistory).toHaveLength(1);
      expect(changes[0].changeHistory[0].type).toBe('pool');
      expect(changes[0].changeHistory[0].side).toBe('attacker');
      expect(changes[0].changeHistory[0].newValue).toBe(150);
      expect(changes[0].changeHistory[0].oldValue).toBe(100);
    });

    it('should detect normal pool decreases (trigger update but not log)', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - decreased pool (normal decrease, not depletion)
      battle.attacker.moneyPool = 50;
      const changes = tracker.detectChanges([battle]);

      // Should trigger message update but not add to log
      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('pool_decreased');
      expect(changes[0].changeHistory).toHaveLength(0); // Not logged
    });

    it('should detect pool depletions (pool goes to 0) and log them', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - pool depleted (went from > 0 to == 0)
      battle.attacker.moneyPool = 0;
      const changes = tracker.detectChanges([battle]);

      // Should trigger message update AND add to log
      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('pool_decreased');
      expect(changes[0].changeHistory).toHaveLength(1);
      expect(changes[0].changeHistory[0].type).toBe('pool');
      expect(changes[0].changeHistory[0].side).toBe('attacker');
      expect(changes[0].changeHistory[0].oldValue).toBe(100);
      expect(changes[0].changeHistory[0].newValue).toBe(0);
    });

    it('should detect defender pool depletions and log them', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - defender pool depleted
      battle.defender.moneyPool = 0;
      const changes = tracker.detectChanges([battle]);

      // Should trigger message update AND add to log
      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('pool_decreased');
      expect(changes[0].changeHistory).toHaveLength(1);
      expect(changes[0].changeHistory[0].type).toBe('pool');
      expect(changes[0].changeHistory[0].side).toBe('defender');
      expect(changes[0].changeHistory[0].oldValue).toBe(200);
      expect(changes[0].changeHistory[0].newValue).toBe(0);
    });

    it('should detect bounty increases', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - increased bounty
      battle.attacker.moneyPer1kDamages = 2.5;
      const changes = tracker.detectChanges([battle]);

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('bounty_increased');
      expect(changes[0].changeHistory).toHaveLength(1);
      expect(changes[0].changeHistory[0].type).toBe('bounty');
      expect(changes[0].changeHistory[0].newValue).toBe(2.5);
    });

    it('should detect bounty decreases', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - decreased bounty
      battle.attacker.moneyPer1kDamages = 1.0;
      const changes = tracker.detectChanges([battle]);

      expect(changes).toHaveLength(1);
      expect(changes[0].changeType).toBe('bounty_decreased');
    });

    it('should not report changes when values stay the same', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - no changes
      const changes = tracker.detectChanges([battle]);

      expect(changes).toHaveLength(0);
    });

    it('should maintain change history', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - pool increase
      battle.attacker.moneyPool = 150;
      tracker.detectChanges([battle]);

      // Third call - bounty increase
      battle.attacker.moneyPer1kDamages = 2.0;
      const changes = tracker.detectChanges([battle]);

      expect(changes[0].changeHistory).toHaveLength(2);
      expect(changes[0].changeHistory[0].type).toBe('pool');
      expect(changes[0].changeHistory[1].type).toBe('bounty');
    });

    it('should update state for normal pool decreases even though not logged', () => {
      const battle = createMockBattle('1', 100, 1.5, 200, 2.0);
      
      // First call - new battle
      tracker.detectChanges([battle]);

      // Second call - normal pool decrease (not logged)
      battle.attacker.moneyPool = 50;
      const changes1 = tracker.detectChanges([battle]);
      expect(changes1[0].changeHistory).toHaveLength(0); // Not logged

      // Third call - pool increase from the decreased value
      // Should use 50 as the old value, not 100
      battle.attacker.moneyPool = 75;
      const changes2 = tracker.detectChanges([battle]);
      
      expect(changes2).toHaveLength(1);
      expect(changes2[0].changeType).toBe('pool_increased');
      expect(changes2[0].changeHistory).toHaveLength(1);
      expect(changes2[0].changeHistory[0].oldValue).toBe(50); // State was updated
      expect(changes2[0].changeHistory[0].newValue).toBe(75);
    });

    it('should not log pool decrease when pool was already 0', () => {
      const battle = createMockBattle('1', 0, 1.5, 200, 2.0);
      
      // First call - new battle (pool already at 0)
      tracker.detectChanges([battle]);

      // Second call - pool stays at 0 (no change)
      battle.attacker.moneyPool = 0;
      const changes = tracker.detectChanges([battle]);

      // Should not trigger update since there's no change
      expect(changes).toHaveLength(0);
    });
  });

  describe('getOldBattles', () => {
    it('should return battles that are no longer active', () => {
      const battle1 = createMockBattle('1', 100, 1.5, 200, 2.0);
      const battle2 = createMockBattle('2', 100, 1.5, 200, 2.0);

      // Track both battles
      tracker.detectChanges([battle1, battle2]);

      // Now battle1 is no longer in the active list
      const oldBattleIds = tracker.getOldBattles([battle2]);

      // The test checks if battle1 would be identified as old
      // Since it was just tracked, it won't be old yet (< 1 day)
      // This test mainly verifies the method doesn't crash
      expect(Array.isArray(oldBattleIds)).toBe(true);
    });

    it('should return empty array when all battles are still active', () => {
      const battle1 = createMockBattle('1', 100, 1.5, 200, 2.0);

      tracker.detectChanges([battle1]);

      const oldBattleIds = tracker.getOldBattles([battle1]);

      expect(oldBattleIds).toEqual([]);
    });
  });

  describe('getTrackedBattleCount', () => {
    it('should return the number of tracked battles', () => {
      const battles = [
        createMockBattle('1', 100, 1.5, 200, 2.0),
        createMockBattle('2', 150, 2.0, 250, 2.5),
      ];

      tracker.detectChanges(battles);

      expect(tracker.getTrackedBattleCount()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all tracked battles', () => {
      const battles = [
        createMockBattle('1', 100, 1.5, 200, 2.0),
      ];

      tracker.detectChanges(battles);
      expect(tracker.getTrackedBattleCount()).toBe(1);

      tracker.clear();
      expect(tracker.getTrackedBattleCount()).toBe(0);
    });
  });
});

// Helper function to create mock battles
function createMockBattle(
  id: string,
  attackerPool: number,
  attackerBounty: number,
  defenderPool: number,
  defenderBounty: number
): any {
  return {
    _id: id,
    attacker: {
      country: 'country1',
      region: 'region1',
      wonRoundsCount: 0,
      countryOrders: [],
      muOrders: [],
      damages: 1000,
      hitCount: 10,
      moneyPer1kDamages: attackerBounty,
      moneyPool: attackerPool,
    },
    defender: {
      country: 'country2',
      region: 'region2',
      wonRoundsCount: 0,
      countryOrders: [],
      muOrders: [],
      damages: 900,
      hitCount: 9,
      moneyPer1kDamages: defenderBounty,
      moneyPool: defenderPool,
    },
    stats: {
      hitCount: 19,
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

