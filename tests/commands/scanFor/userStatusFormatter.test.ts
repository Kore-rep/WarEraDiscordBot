import { isSkillResetAvailable } from '../../../src/commands/scanFor/country/userStatusFormatter';
import type { ScanUserLite } from '../../../src/services/scan/ScanService';

const DAY = 86_400_000;
const now = new Date('2026-07-13T00:00:00Z');

const makeUser = (freeReset: number, lastSkillsResetAt?: string): ScanUserLite =>
  ({
    leveling: { freeReset },
    dates: lastSkillsResetAt ? { lastSkillsResetAt } : {},
  }) as unknown as ScanUserLite;

describe('isSkillResetAvailable', () => {
  it('is available when a stored bonus reset exists, regardless of cooldown', () => {
    const user = makeUser(1, new Date(now.getTime() - 1 * DAY).toISOString());
    expect(isSkillResetAvailable(user, 7, now)).toBe(true);
  });

  it('is available once the cooldown has elapsed even with freeReset 0', () => {
    // Regression: freeReset alone said "unavailable" for users whose periodic
    // reset was ready (e.g. last reset 35 days ago with a 7-day cooldown).
    const user = makeUser(0, new Date(now.getTime() - 35 * DAY).toISOString());
    expect(isSkillResetAvailable(user, 7, now)).toBe(true);
  });

  it('is unavailable inside the cooldown with no stored reset', () => {
    const user = makeUser(0, new Date(now.getTime() - 3 * DAY).toISOString());
    expect(isSkillResetAvailable(user, 7, now)).toBe(false);
  });

  it('is inclusive at the cooldown boundary', () => {
    const user = makeUser(0, new Date(now.getTime() - 7 * DAY).toISOString());
    expect(isSkillResetAvailable(user, 7, now)).toBe(true);
  });

  it('is available for users who have never reset', () => {
    expect(isSkillResetAvailable(makeUser(0), 7, now)).toBe(true);
  });

  it('respects a non-default cooldown', () => {
    const user = makeUser(0, new Date(now.getTime() - 10 * DAY).toISOString());
    expect(isSkillResetAvailable(user, 14, now)).toBe(false);
    expect(isSkillResetAvailable(user, 7, now)).toBe(true);
  });
});
