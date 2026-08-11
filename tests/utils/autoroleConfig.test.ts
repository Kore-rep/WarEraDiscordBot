import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import { prisma } from '../../src/persistence/prisma';
import { pushTestSchema, clearTables } from '../setup/testDb';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const SERVER = 'autorole-server';

describe('ServerConfigManager autorole config', () => {
  beforeAll(() => {
    pushTestSchema();
  });

  afterAll(async () => {
    ServerConfigManager.clearCache();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await ServerConfigManager.flush();
    await clearTables();
    await prisma.server.create({ data: { id: SERVER } });
    await ServerConfigManager.loadConfigs();
  });

  afterEach(async () => {
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
  });

  it('creates a default block on first update', () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      allowedCountryIds: ['country-1'],
    });

    expect(ServerConfigManager.getAutoroleConfig(SERVER)).toMatchObject({
      enabled: true,
      checkIntervalSeconds: 3600,
      ecoThreshold: 60,
      warThreshold: 60,
      opsecMinLevel: 15,
      opsecInactivityDays: 2,
      skipCompanyVerification: false,
      allowedCountryIds: ['country-1'],
      levelRoles: [],
      timedRoles: [],
      manageRoleIds: [],
      manageUserIds: [],
      proxyRoleIds: [],
      protectedRoleIds: [],
      linkMessages: [],
    });
  });

  it('merges partial updates over the existing block', () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      levelRoles: [{ roleId: 'r1', minLevel: 10 }],
      manageRoleIds: ['staff-1'],
    });
    ServerConfigManager.updateAutoroleConfig(SERVER, { enabled: false, ecoThreshold: 80 });

    const config = ServerConfigManager.getAutoroleConfig(SERVER);
    expect(config?.levelRoles).toEqual([{ roleId: 'r1', minLevel: 10 }]);
    expect(config?.manageRoleIds).toEqual(['staff-1']);
    expect(config?.enabled).toBe(false);
    expect(config?.ecoThreshold).toBe(80);
    expect(config?.warThreshold).toBe(60);
  });

  it('enforces the 60-second interval floor', () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, { checkIntervalSeconds: 5 });
    expect(ServerConfigManager.getAutoroleConfig(SERVER)?.checkIntervalSeconds).toBe(60);
  });

  it('filters blank ids on normalization when reloaded from the database', async () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      levelRoles: [
        { roleId: 'r1', minLevel: 5 },
        { roleId: '', minLevel: 10 },
      ],
      manageRoleIds: ['staff-1', ''],
      proxyRoleIds: [' ', 'proxy-1'],
      allowedCountryIds: ['c1', ''],
      linkMessages: [
        { channelId: 'chan-1', messageId: 'msg-1' },
        { channelId: '', messageId: 'msg-2' },
      ],
    });
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    const config = ServerConfigManager.getAutoroleConfig(SERVER);
    expect(config?.levelRoles).toEqual([{ roleId: 'r1', minLevel: 5 }]);
    expect(config?.manageRoleIds).toEqual(['staff-1']);
    expect(config?.proxyRoleIds).toEqual(['proxy-1']);
    expect(config?.allowedCountryIds).toEqual(['c1']);
    expect(config?.linkMessages).toEqual([{ channelId: 'chan-1', messageId: 'msg-1' }]);
  });

  it('round-trips through the database', async () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      checkIntervalSeconds: 7200,
      lastSyncAt: '2026-07-11T12:00:00.000Z',
      levelRoles: [{ roleId: 'r1', minLevel: 10 }],
      timedRoles: [{ roleId: 'r2', timeoutDays: 7.5 }],
      ecoRoleId: 'eco',
      warRoleId: 'war',
      hybridRoleId: 'hybrid',
      ecoThreshold: 80,
      warThreshold: 75,
      opsecRoleId: 'opsec',
      opsecExceptionRoleId: 'opsec-exempt',
      opsecMinLevel: 20,
      opsecInactivityDays: 5,
      manageRoleIds: ['staff-1'],
      manageUserIds: ['user-1'],
      proxyRoleIds: ['proxy-1'],
      protectedRoleIds: ['protected-1'],
      allowedCountryIds: ['c1'],
      reviewChannelId: 'review-chan',
      skipCompanyVerification: true,
      linkMessages: [{ channelId: 'chan-1', messageId: 'msg-1' }],
      syncNicknames: false,
    });
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    expect(ServerConfigManager.getAutoroleConfig(SERVER)).toEqual({
      enabled: true,
      checkIntervalSeconds: 7200,
      lastSyncAt: '2026-07-11T12:00:00.000Z',
      levelRoles: [{ roleId: 'r1', minLevel: 10 }],
      timedRoles: [{ roleId: 'r2', timeoutDays: 7.5 }],
      ecoRoleId: 'eco',
      warRoleId: 'war',
      hybridRoleId: 'hybrid',
      ecoThreshold: 80,
      warThreshold: 75,
      opsecRoleId: 'opsec',
      opsecExceptionRoleId: 'opsec-exempt',
      opsecMinLevel: 20,
      opsecInactivityDays: 5,
      manageRoleIds: ['staff-1'],
      manageUserIds: ['user-1'],
      proxyRoleIds: ['proxy-1'],
      protectedRoleIds: ['protected-1'],
      allowedCountryIds: ['c1'],
      reviewChannelId: 'review-chan',
      skipCompanyVerification: true,
      linkMessages: [{ channelId: 'chan-1', messageId: 'msg-1' }],
      syncNicknames: false,
    });
  });

  it('returns a deep copy that does not mutate the cache', () => {
    ServerConfigManager.updateAutoroleConfig(SERVER, {
      levelRoles: [{ roleId: 'r1', minLevel: 10 }],
    });
    const config = ServerConfigManager.getAutoroleConfig(SERVER)!;
    config.levelRoles.push({ roleId: 'injected', minLevel: 1 });
    config.levelRoles[0].minLevel = 99;
    config.manageRoleIds.push('leak');

    const fresh = ServerConfigManager.getAutoroleConfig(SERVER);
    expect(fresh?.levelRoles).toEqual([{ roleId: 'r1', minLevel: 10 }]);
    expect(fresh?.manageRoleIds).toEqual([]);
  });
});
