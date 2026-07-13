import { getBestRoleForLevel } from '../../../src/services/autorole/levelRoles';

describe('getBestRoleForLevel', () => {
  const entries = [
    { roleId: 'r10', minLevel: 10 },
    { roleId: 'r30', minLevel: 30 },
    { roleId: 'r20', minLevel: 20 },
  ];

  it('picks the highest qualifying minLevel regardless of order', () => {
    expect(getBestRoleForLevel(entries, 25)).toBe('r20');
    expect(getBestRoleForLevel(entries, 30)).toBe('r30');
  });

  it('is inclusive at the boundary', () => {
    expect(getBestRoleForLevel(entries, 10)).toBe('r10');
  });

  it('returns undefined below every threshold or with no entries', () => {
    expect(getBestRoleForLevel(entries, 5)).toBeUndefined();
    expect(getBestRoleForLevel([], 99)).toBeUndefined();
  });
});
