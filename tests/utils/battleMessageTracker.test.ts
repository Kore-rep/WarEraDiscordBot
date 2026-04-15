import { BattleMessageTracker } from '../../src/utils/battleMessageTracker';
import * as fs from 'fs';
import * as path from 'path';

// Mock dependencies
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('BattleMessageTracker', () => {
  const testBattlesFile = path.join(process.cwd(), 'battles.json');

  beforeEach(() => {
    // Clear all battles before each test
    BattleMessageTracker.clearAll();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clean up test file
    BattleMessageTracker.clearAll();
  });
  
  afterAll(() => {
    // Final cleanup
    BattleMessageTracker.clearAll();
  });

  describe('setBattleMessage', () => {
    it('should persist a battle message entry', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');

      const battles = BattleMessageTracker.loadBattles();
      const entry = battles.get('server1:battle1');

      expect(entry).toBeDefined();
      expect(entry?.serverId).toBe('server1');
      expect(entry?.battleId).toBe('battle1');
      expect(entry?.messageId).toBe('message1');
      expect(entry?.timestamp).toBeDefined();
    });

    it('should update existing battle message entry', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message2');

      const battles = BattleMessageTracker.loadBattles();
      const entry = battles.get('server1:battle1');

      expect(entry?.messageId).toBe('message2');
    });

    it('should handle multiple battles', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server1', 'battle2', 'message2');
      BattleMessageTracker.setBattleMessage('server2', 'battle1', 'message3');

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(3);
      expect(battles.get('server1:battle1')?.messageId).toBe('message1');
      expect(battles.get('server1:battle2')?.messageId).toBe('message2');
      expect(battles.get('server2:battle1')?.messageId).toBe('message3');
    });
  });

  describe('removeBattleMessage', () => {
    it('should remove a battle message entry', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server1', 'battle2', 'message2');

      BattleMessageTracker.removeBattleMessage('server1', 'battle1');

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(1);
      expect(battles.has('server1:battle1')).toBe(false);
      expect(battles.has('server1:battle2')).toBe(true);
    });

    it('should handle removing non-existent battle', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');

      BattleMessageTracker.removeBattleMessage('server1', 'battle999');

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(1);
    });
  });

  describe('clearServer', () => {
    it('should clear all battles for a server', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server1', 'battle2', 'message2');
      BattleMessageTracker.setBattleMessage('server2', 'battle1', 'message3');

      BattleMessageTracker.clearServer('server1');

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(1);
      expect(battles.has('server1:battle1')).toBe(false);
      expect(battles.has('server1:battle2')).toBe(false);
      expect(battles.has('server2:battle1')).toBe(true);
    });

    it('should handle clearing server with no battles', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');

      BattleMessageTracker.clearServer('server999');

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(1);
    });
  });

  describe('getServerBattles', () => {
    it('should return all battle IDs for a server', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server1', 'battle2', 'message2');
      BattleMessageTracker.setBattleMessage('server2', 'battle3', 'message3');

      const server1Battles = BattleMessageTracker.getServerBattles('server1');

      expect(server1Battles).toHaveLength(2);
      expect(server1Battles).toContain('battle1');
      expect(server1Battles).toContain('battle2');
      expect(server1Battles).not.toContain('battle3');
    });

    it('should return empty array for server with no battles', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');

      const server2Battles = BattleMessageTracker.getServerBattles('server2');

      expect(server2Battles).toEqual([]);
    });
  });

  describe('loadBattles', () => {
    it('should load battles from file', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');

      // Reload from disk
      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(1);
      expect(battles.get('server1:battle1')?.messageId).toBe('message1');
    });

    it('should return empty map if file does not exist', () => {
      // Delete the file if it exists
      if (fs.existsSync(testBattlesFile)) {
        fs.unlinkSync(testBattlesFile);
      }

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(0);
      // File should not be created by loadBattles(), only by write operations
      expect(fs.existsSync(testBattlesFile)).toBe(false);
    });

    it('should handle corrupted JSON file', () => {
      // Write invalid JSON
      fs.writeFileSync(testBattlesFile, '{invalid json}', 'utf-8');

      const battles = BattleMessageTracker.loadBattles();

      // Should return empty map on error
      expect(battles.size).toBe(0);
    });
  });

  describe('pruneInactiveBattles', () => {
    it('should remove entries for battles not in the active set', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle-old', 'm1');
      BattleMessageTracker.setBattleMessage('server1', 'battle-new', 'm2');

      const removed = BattleMessageTracker.pruneInactiveBattles(new Set(['battle-new']));

      expect(removed).toEqual(
        expect.arrayContaining([{ serverId: 'server1', battleId: 'battle-old' }])
      );
      const battles = BattleMessageTracker.loadBattles();
      expect(battles.has('server1:battle-new')).toBe(true);
      expect(battles.has('server1:battle-old')).toBe(false);
    });

    it('should return empty array when all battles are active', () => {
      BattleMessageTracker.setBattleMessage('server1', 'b1', 'm1');
      const removed = BattleMessageTracker.pruneInactiveBattles(new Set(['b1']));
      expect(removed).toEqual([]);
    });
  });

  describe('clearAll', () => {
    it('should clear all battle messages', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server2', 'battle2', 'message2');

      BattleMessageTracker.clearAll();

      const battles = BattleMessageTracker.loadBattles();

      expect(battles.size).toBe(0);
    });
  });

  describe('persistence', () => {
    it('should persist changes across multiple operations', () => {
      BattleMessageTracker.setBattleMessage('server1', 'battle1', 'message1');
      BattleMessageTracker.setBattleMessage('server1', 'battle2', 'message2');
      
      const battles1 = BattleMessageTracker.loadBattles();
      expect(battles1.size).toBe(2);

      BattleMessageTracker.removeBattleMessage('server1', 'battle1');
      
      const battles2 = BattleMessageTracker.loadBattles();
      expect(battles2.size).toBe(1);
      expect(battles2.has('server1:battle1')).toBe(false);
    });
  });
});
