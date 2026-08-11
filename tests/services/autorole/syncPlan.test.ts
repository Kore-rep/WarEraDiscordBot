import { AutoroleConfig, MilitaryUnitEntry } from '../../../src/config/config';
import { computeMemberSyncPlan, MemberSyncContext, SyncUserView } from '../../../src/services/autorole/syncPlan';

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
  ecoRoleId: 'eco',
  warRoleId: 'war',
  hybridRoleId: 'hybrid',
  ecoThreshold: 60,
  warThreshold: 60,
  opsecMinLevel: 15,
  opsecInactivityDays: 2,
  manageRoleIds: [],
  manageUserIds: [],
  proxyRoleIds: [],
  protectedRoleIds: [],
  allowedCountryIds: [],
  skipCompanyVerification: false,
  linkMessages: [],
  ...overrides,
});

const baseUnits: MilitaryUnitEntry[] = [{ muId: 'mu-1', muName: 'Assegai', roleId: 'mu-role-1' }];

const baseUser = (overrides: Partial<SyncUserView> = {}): SyncUserView => ({
  username: 'Player',
  level: 15,
  muId: 'mu-1',
  skills: { attack: { level: 10 } },
  lastConnectionAt: new Date(now.getTime() - DAY),
  ...overrides,
});

const ctx = (
  cfg: AutoroleConfig,
  militaryUnits: MilitaryUnitEntry[] = baseUnits,
  opsecRevoked = false
): MemberSyncContext => ({ cfg, militaryUnits, opsecRevoked, now });

describe('computeMemberSyncPlan', () => {
  it('adds the level, build and MU roles the member qualifies for', () => {
    const plan = computeMemberSyncPlan(baseUser(), [], null, ctx(baseConfig()));
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
      ctx(baseConfig())
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
      ctx(baseConfig({ protectedRoleIds: ['lvl10'] }))
    );
    expect(plan.rolesToRemove).toEqual([]);
    expect(plan.rolesToAdd).toContain('lvl30');
  });

  it('does not remove a role another facet is adding', () => {
    // The same role doubles as a level role and the MU role.
    const cfg = baseConfig({ levelRoles: [{ roleId: 'shared', minLevel: 50 }] });
    const units: MilitaryUnitEntry[] = [{ muId: 'mu-1', muName: 'Assegai', roleId: 'shared' }];
    const plan = computeMemberSyncPlan(baseUser({ level: 15, skills: {} }), ['shared'], null, ctx(cfg, units));
    expect(plan.rolesToRemove).toEqual([]);
    expect(plan.rolesToAdd).toEqual([]);
  });

  it('applies timed removals for inactive members', () => {
    const plan = computeMemberSyncPlan(
      baseUser({ lastConnectionAt: new Date(now.getTime() - 10 * DAY) }),
      ['active'],
      null,
      ctx(baseConfig())
    );
    expect(plan.rolesToRemove).toContain('active');
  });

  it('flags members without a mapped MU and nicknames them TBD', () => {
    const plan = computeMemberSyncPlan(baseUser({ muId: 'unmapped-mu' }), [], null, ctx(baseConfig()));
    expect(plan.needsMuNotice).toBe(true);
    expect(plan.desiredNickname).toBe('Player (TBD)');
    expect(plan.rolesToAdd).not.toContain('mu-role-1');
  });

  it('treats an MU listed without a role as unmapped (TBD)', () => {
    const units: MilitaryUnitEntry[] = [{ muId: 'mu-1', muName: 'Assegai' }];
    const plan = computeMemberSyncPlan(baseUser(), [], null, ctx(baseConfig(), units));
    expect(plan.needsMuNotice).toBe(true);
    expect(plan.desiredNickname).toBe('Player (TBD)');
  });

  it('skips nickname changes when syncNicknames is disabled', () => {
    const plan = computeMemberSyncPlan(baseUser(), [], null, ctx(baseConfig({ syncNicknames: false })));
    expect(plan.desiredNickname).toBeUndefined();
  });

  it('grants the linked role to a linked member and keeps it', () => {
    const cfg = baseConfig({ linkedRoleId: 'linked' });
    const missing = computeMemberSyncPlan(baseUser(), [], null, ctx(cfg));
    expect(missing.rolesToAdd).toContain('linked');

    const held = computeMemberSyncPlan(baseUser(), ['linked'], null, ctx(cfg));
    expect(held.rolesToAdd).not.toContain('linked');
    expect(held.rolesToRemove).not.toContain('linked');
  });

  it('strips the unlinked role from a linked member (never targets it)', () => {
    const plan = computeMemberSyncPlan(
      baseUser(),
      ['unlinked', 'lvl10', 'war', 'mu-role-1'],
      'Player (Assegai)',
      ctx(baseConfig({ unlinkedRoleId: 'unlinked' }))
    );
    expect(plan.rolesToRemove).toContain('unlinked');
    expect(plan.rolesToAdd).not.toContain('unlinked');
  });

  it('removes a held MU role when the user left that MU', () => {
    const plan = computeMemberSyncPlan(baseUser({ muId: undefined }), ['mu-role-1'], null, ctx(baseConfig()));
    expect(plan.rolesToRemove).toContain('mu-role-1');
    expect(plan.needsMuNotice).toBe(true);
  });

  describe('OPSEC role', () => {
    const opsecCfg = (over: Partial<AutoroleConfig> = {}) =>
      baseConfig({ opsecRoleId: 'opsec', opsecMinLevel: 15, opsecInactivityDays: 2, ...over });

    it('grants OPSEC once the member reaches the min level and is active', () => {
      const plan = computeMemberSyncPlan(baseUser({ level: 15 }), [], null, ctx(opsecCfg()));
      expect(plan.rolesToAdd).toContain('opsec');
      expect(plan.revokeOpsec).toBe(false);
    });

    it('does not grant OPSEC below the min level', () => {
      const plan = computeMemberSyncPlan(baseUser({ level: 14 }), [], null, ctx(opsecCfg()));
      expect(plan.rolesToAdd).not.toContain('opsec');
    });

    it('does not grant OPSEC to an inactive member even if they qualify by level', () => {
      const plan = computeMemberSyncPlan(
        baseUser({ level: 30, lastConnectionAt: new Date(now.getTime() - 5 * DAY) }),
        [],
        null,
        ctx(opsecCfg())
      );
      expect(plan.rolesToAdd).not.toContain('opsec');
    });

    it('revokes OPSEC from an inactive holder and signals the persistence', () => {
      const plan = computeMemberSyncPlan(
        baseUser({ level: 30, lastConnectionAt: new Date(now.getTime() - 5 * DAY) }),
        ['opsec'],
        null,
        ctx(opsecCfg())
      );
      expect(plan.rolesToRemove).toContain('opsec');
      expect(plan.revokeOpsec).toBe(true);
    });

    it('keeps OPSEC for an active holder', () => {
      const plan = computeMemberSyncPlan(baseUser({ level: 30 }), ['opsec'], null, ctx(opsecCfg()));
      expect(plan.rolesToRemove).not.toContain('opsec');
      expect(plan.rolesToAdd).not.toContain('opsec');
      expect(plan.revokeOpsec).toBe(false);
    });

    it('is hands-off once revoked: never re-adds when active again', () => {
      const plan = computeMemberSyncPlan(baseUser({ level: 30 }), [], null, ctx(opsecCfg(), baseUnits, true));
      expect(plan.rolesToAdd).not.toContain('opsec');
      expect(plan.revokeOpsec).toBe(false);
    });

    it('is hands-off once revoked: never re-strips a manual re-add while inactive', () => {
      const plan = computeMemberSyncPlan(
        baseUser({ level: 30, lastConnectionAt: new Date(now.getTime() - 5 * DAY) }),
        ['opsec'],
        null,
        ctx(opsecCfg(), baseUnits, true)
      );
      expect(plan.rolesToRemove).not.toContain('opsec');
      expect(plan.revokeOpsec).toBe(false);
    });

    it('does not auto-grant OPSEC when auto-apply is off', () => {
      const cfg = opsecCfg({ opsecAutoApply: false });
      const plan = computeMemberSyncPlan(baseUser({ level: 30 }), [], null, ctx(cfg));
      expect(plan.rolesToAdd).not.toContain('opsec');
    });

    it('still revokes OPSEC on inactivity even when auto-apply is off', () => {
      const cfg = opsecCfg({ opsecAutoApply: false });
      const plan = computeMemberSyncPlan(
        baseUser({ level: 30, lastConnectionAt: new Date(now.getTime() - 5 * DAY) }),
        ['opsec'],
        null,
        ctx(cfg)
      );
      expect(plan.rolesToRemove).toContain('opsec');
      expect(plan.revokeOpsec).toBe(true);
    });
  });
});
