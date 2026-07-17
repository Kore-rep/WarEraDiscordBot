import { AutoroleConfig } from '../../../src/config/config';
import { computeMemberSyncPlan, SyncUserView } from '../../../src/services/autorole/syncPlan';

const DAY = 86_400_000;
const now = new Date('2026-07-11T00:00:00Z');

const baseConfig = (overrides: Partial<AutoroleConfig> = {}): AutoroleConfig => ({
  enabled: true,
  checkIntervalSeconds: 3600,
  levelRoles: [
    { roleId: 'lvl10', minLevel: 10 },
    { roleId: 'lvl30', minLevel: 30 },
  ],
  timedRoles: [{ roleId: 'active', timeoutDays: 7 }],
  muRoles: [{ muId: 'mu-1', muName: 'Assegai', roleId: 'mu-role-1' }],
  ecoRoleId: 'eco',
  warRoleId: 'war',
  hybridRoleId: 'hybrid',
  ecoThreshold: 60,
  warThreshold: 60,
  manageRoleIds: [],
  manageUserIds: [],
  proxyRoleIds: [],
  protectedRoleIds: [],
  allowedCountryIds: [],
  skipCompanyVerification: false,
  linkMessages: [],
  ...overrides,
});

const baseUser = (overrides: Partial<SyncUserView> = {}): SyncUserView => ({
  username: 'Player',
  level: 15,
  muId: 'mu-1',
  skills: { attack: { level: 10 } },
  lastConnectionAt: new Date(now.getTime() - DAY),
  ...overrides,
});

describe('computeMemberSyncPlan', () => {
  it('adds the level, build and MU roles the member qualifies for', () => {
    const plan = computeMemberSyncPlan(baseUser(), [], null, baseConfig(), now);
    expect(plan.rolesToAdd.sort()).toEqual(['lvl10', 'mu-role-1', 'war']);
    expect(plan.rolesToRemove).toEqual([]);
    expect(plan.needsMuNotice).toBe(false);
    expect(plan.desiredNickname).toBe('Player (Assegai)');
  });

  it('removes managed roles the member no longer qualifies for', () => {
    const plan = computeMemberSyncPlan(
      baseUser({ level: 35, skills: { companies: { level: 10 } } }),
      ['lvl10', 'war', 'mu-role-1'],
      'Player (Assegai)',
      baseConfig(),
      now
    );
    expect(plan.rolesToAdd.sort()).toEqual(['eco', 'lvl30']);
    expect(plan.rolesToRemove.sort()).toEqual(['lvl10', 'war']);
    expect(plan.desiredNickname).toBeUndefined();
  });

  it('never removes protected roles', () => {
    const plan = computeMemberSyncPlan(
      baseUser({ level: 35 }),
      ['lvl10'],
      null,
      baseConfig({ protectedRoleIds: ['lvl10'] }),
      now
    );
    expect(plan.rolesToRemove).toEqual([]);
    expect(plan.rolesToAdd).toContain('lvl30');
  });

  it('does not remove a role another facet is adding', () => {
    // The same role doubles as a level role and the MU role.
    const cfg = baseConfig({
      levelRoles: [{ roleId: 'shared', minLevel: 50 }],
      muRoles: [{ muId: 'mu-1', muName: 'Assegai', roleId: 'shared' }],
    });
    const plan = computeMemberSyncPlan(baseUser({ level: 15, skills: {} }), ['shared'], null, cfg, now);
    expect(plan.rolesToRemove).toEqual([]);
    expect(plan.rolesToAdd).toEqual([]);
  });

  it('applies timed removals for inactive members', () => {
    const plan = computeMemberSyncPlan(
      baseUser({ lastConnectionAt: new Date(now.getTime() - 10 * DAY) }),
      ['active'],
      null,
      baseConfig(),
      now
    );
    expect(plan.rolesToRemove).toContain('active');
  });

  it('flags members without a mapped MU and nicknames them TBD', () => {
    const plan = computeMemberSyncPlan(baseUser({ muId: 'unmapped-mu' }), [], null, baseConfig(), now);
    expect(plan.needsMuNotice).toBe(true);
    expect(plan.desiredNickname).toBe('Player (TBD)');
    expect(plan.rolesToAdd).not.toContain('mu-role-1');
  });

  it('skips nickname changes when syncNicknames is disabled', () => {
    const plan = computeMemberSyncPlan(baseUser(), [], null, baseConfig({ syncNicknames: false }), now);
    expect(plan.desiredNickname).toBeUndefined();
  });

  it('grants the linked role to a linked member and keeps it', () => {
    const cfg = baseConfig({ linkedRoleId: 'linked' });
    const missing = computeMemberSyncPlan(baseUser(), [], null, cfg, now);
    expect(missing.rolesToAdd).toContain('linked');

    const held = computeMemberSyncPlan(baseUser(), ['linked'], null, cfg, now);
    expect(held.rolesToAdd).not.toContain('linked');
    expect(held.rolesToRemove).not.toContain('linked');
  });

  it('strips the unlinked role from a linked member (never targets it)', () => {
    const plan = computeMemberSyncPlan(
      baseUser(),
      ['unlinked', 'lvl10', 'war', 'mu-role-1'],
      'Player (Assegai)',
      baseConfig({ unlinkedRoleId: 'unlinked' }),
      now
    );
    expect(plan.rolesToRemove).toContain('unlinked');
    expect(plan.rolesToAdd).not.toContain('unlinked');
  });

  it('removes a held MU role when the user left that MU', () => {
    const plan = computeMemberSyncPlan(baseUser({ muId: undefined }), ['mu-role-1'], null, baseConfig(), now);
    expect(plan.rolesToRemove).toContain('mu-role-1');
    expect(plan.needsMuNotice).toBe(true);
  });
});
