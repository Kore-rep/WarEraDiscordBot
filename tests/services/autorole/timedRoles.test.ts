import { timedRolesToRemove } from '../../../src/services/autorole/timedRoles';

const DAY = 86_400_000;
const now = new Date('2026-07-11T00:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY);

describe('timedRolesToRemove', () => {
  const entries = [
    { roleId: 'inactive7', timeoutDays: 7 },
    { roleId: 'inactive30', timeoutDays: 30 },
  ];

  it('removes only roles whose timeout has elapsed and the member holds', () => {
    expect(timedRolesToRemove(entries, ['inactive7', 'inactive30'], daysAgo(10), now)).toEqual([
      'inactive7',
    ]);
  });

  it('is inclusive at the boundary', () => {
    expect(timedRolesToRemove(entries, ['inactive7'], daysAgo(7), now)).toEqual(['inactive7']);
  });

  it('skips roles the member does not hold', () => {
    expect(timedRolesToRemove(entries, [], daysAgo(100), now)).toEqual([]);
  });

  it('removes nothing when lastConnectionAt is unknown', () => {
    expect(timedRolesToRemove(entries, ['inactive7'], undefined, now)).toEqual([]);
  });

  it('ignores non-positive timeouts', () => {
    expect(timedRolesToRemove([{ roleId: 'r', timeoutDays: 0 }], ['r'], daysAgo(100), now)).toEqual([]);
  });
});
