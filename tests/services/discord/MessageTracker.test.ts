/// <reference types="jest" />
import { LegacyMessageTracker as MessageTracker } from '../../../src/services/discord/LegacyMessageTracker';

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('MessageTracker', () => {
  let tracker: MessageTracker;

  beforeEach(() => {
    tracker = new MessageTracker();
  });

  describe('setMessageId', () => {
    it('should store a message ID for a battle', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');

      const messageId = tracker.getMessageId('server1', 'battle1');
      expect(messageId).toBe('message1');
    });

    it('should handle multiple servers', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.setMessageId('server2', 'battle1', 'message2');

      expect(tracker.getMessageId('server1', 'battle1')).toBe('message1');
      expect(tracker.getMessageId('server2', 'battle1')).toBe('message2');
    });

    it('should handle multiple battles per server', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.setMessageId('server1', 'battle2', 'message2');

      expect(tracker.getMessageId('server1', 'battle1')).toBe('message1');
      expect(tracker.getMessageId('server1', 'battle2')).toBe('message2');
    });

    it('should overwrite existing message ID', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.setMessageId('server1', 'battle1', 'message2');

      expect(tracker.getMessageId('server1', 'battle1')).toBe('message2');
    });
  });

  describe('getMessageId', () => {
    it('should return undefined for non-existent entries', () => {
      const messageId = tracker.getMessageId('server1', 'battle1');
      expect(messageId).toBeUndefined();
    });
  });

  describe('removeBattle', () => {
    it('should remove tracking for a battle', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.removeBattle('server1', 'battle1');

      expect(tracker.getMessageId('server1', 'battle1')).toBeUndefined();
    });

    it('should not affect other battles', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.setMessageId('server1', 'battle2', 'message2');
      tracker.removeBattle('server1', 'battle1');

      expect(tracker.getMessageId('server1', 'battle1')).toBeUndefined();
      expect(tracker.getMessageId('server1', 'battle2')).toBe('message2');
    });
  });

  describe('getTrackedBattles', () => {
    it('should return all tracked battles for a server', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.setMessageId('server1', 'battle2', 'message2');
      tracker.setMessageId('server2', 'battle3', 'message3');

      const battles = tracker.getTrackedBattles('server1');

      expect(battles).toHaveLength(2);
      expect(battles).toContain('battle1');
      expect(battles).toContain('battle2');
      expect(battles).not.toContain('battle3');
    });

    it('should return empty array for server with no battles', () => {
      const battles = tracker.getTrackedBattles('server1');
      expect(battles).toEqual([]);
    });
  });

  describe('clearServer', () => {
    it('should clear all tracking for a server', () => {
      tracker.setMessageId('server1', 'battle1', 'message1');
      tracker.setMessageId('server1', 'battle2', 'message2');
      tracker.setMessageId('server2', 'battle3', 'message3');

      tracker.clearServer('server1');

      expect(tracker.getTrackedBattles('server1')).toEqual([]);
      expect(tracker.getTrackedBattles('server2')).toHaveLength(1);
    });
  });
});

