import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import { prisma } from '../../src/persistence/prisma';
import { pushTestSchema, clearTables } from '../setup/testDb';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const SERVER = 'mu-dir-server';

describe('ServerConfigManager MU directory config', () => {
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
    ServerConfigManager.updateMuDirectoryConfig(SERVER, {
      channelId: 'chan-1',
      militaryUnitIds: ['mu1', 'mu2'],
    });

    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)).toMatchObject({
      enabled: true,
      channelId: 'chan-1',
      militaryUnitIds: ['mu1', 'mu2'],
      manageRoleIds: [],
      messageIds: [],
    });
  });

  it('merges partial updates over the existing block', () => {
    ServerConfigManager.updateMuDirectoryConfig(SERVER, {
      channelId: 'chan-1',
      militaryUnitIds: ['mu1'],
      manageRoleIds: ['role-1'],
    });
    // A later update that omits militaryUnitIds keeps the existing list.
    ServerConfigManager.updateMuDirectoryConfig(SERVER, { enabled: false });

    const config = ServerConfigManager.getMuDirectoryConfig(SERVER);
    expect(config?.militaryUnitIds).toEqual(['mu1']);
    expect(config?.manageRoleIds).toEqual(['role-1']);
    expect(config?.enabled).toBe(false);
  });

  it('filters blank ids on normalization when reloaded from the database', async () => {
    ServerConfigManager.updateMuDirectoryConfig(SERVER, {
      channelId: 'chan-1',
      militaryUnitIds: ['mu1', '', '  ', 'mu2'],
      manageRoleIds: ['role-1', ''],
      messageIds: ['m1', ''],
    });
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    const config = ServerConfigManager.getMuDirectoryConfig(SERVER);
    expect(config?.militaryUnitIds).toEqual(['mu1', 'mu2']);
    expect(config?.manageRoleIds).toEqual(['role-1']);
    expect(config?.messageIds).toEqual(['m1']);
  });

  it('round-trips through the database', async () => {
    ServerConfigManager.updateMuDirectoryConfig(SERVER, {
      channelId: 'chan-1',
      militaryUnitIds: ['mu1'],
      manageRoleIds: ['role-1'],
      messageIds: ['m1'],
      lastUpdated: '2026-07-09T12:00:00.000Z',
    });
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)).toEqual({
      enabled: true,
      channelId: 'chan-1',
      militaryUnitIds: ['mu1'],
      manageRoleIds: ['role-1'],
      messageIds: ['m1'],
      lastUpdated: '2026-07-09T12:00:00.000Z',
    });
  });

  it('returns a deep copy that does not mutate the cache', () => {
    ServerConfigManager.updateMuDirectoryConfig(SERVER, {
      channelId: 'chan-1',
      militaryUnitIds: ['mu1'],
    });
    const config = ServerConfigManager.getMuDirectoryConfig(SERVER)!;
    config.militaryUnitIds.push('injected');
    config.messageIds.push('leak');

    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)?.militaryUnitIds).toEqual(['mu1']);
    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)?.messageIds).toEqual([]);
  });
});
