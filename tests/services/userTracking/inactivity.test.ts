import { daysSinceLastConnection, isInactive } from '../../../src/services/userTracking/inactivity';

const DAY = 86_400_000;
const now = new Date('2026-07-11T00:00:00Z');

describe('inactivity helpers', () => {
  describe('daysSinceLastConnection', () => {
    it('returns fractional days elapsed', () => {
      expect(daysSinceLastConnection(new Date(now.getTime() - 3 * DAY), now)).toBeCloseTo(3);
      expect(daysSinceLastConnection(new Date(now.getTime() - 0.5 * DAY), now)).toBeCloseTo(0.5);
    });

    it('accepts an ISO string', () => {
      expect(daysSinceLastConnection(new Date(now.getTime() - 2 * DAY).toISOString(), now)).toBeCloseTo(2);
    });

    it('returns undefined for missing or invalid input', () => {
      expect(daysSinceLastConnection(undefined, now)).toBeUndefined();
      expect(daysSinceLastConnection('not-a-date', now)).toBeUndefined();
    });
  });

  describe('isInactive', () => {
    it('is true at or beyond the threshold', () => {
      expect(isInactive(new Date(now.getTime() - 2 * DAY), 2, now)).toBe(true);
      expect(isInactive(new Date(now.getTime() - 3 * DAY), 2, now)).toBe(true);
    });

    it('is false below the threshold', () => {
      expect(isInactive(new Date(now.getTime() - 1 * DAY), 2, now)).toBe(false);
    });

    it('treats missing data as not inactive', () => {
      expect(isInactive(undefined, 2, now)).toBe(false);
    });
  });
});
