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

  it('creates a default block when adding the first unit', () => {
    const added = ServerConfigManager.addMuDirectoryUnit(SERVER, {
      id: 'mu1',
      name: 'Alpha',
      url: 'https://app.warera.io/mu/mu1',
    });
    expect(added).toBe(true);

    const config = ServerConfigManager.getMuDirectoryConfig(SERVER);
    expect(config).toMatchObject({
      enabled: true,
      channelId: '',
      units: [{ id: 'mu1', name: 'Alpha', url: 'https://app.warera.io/mu/mu1' }],
      manageRoleIds: [],
      messageIds: [],
    });
  });

  it('dedupes units by id', () => {
    ServerConfigManager.addMuDirectoryUnit(SERVER, { id: 'mu1', name: 'Alpha', url: 'u' });
    const second = ServerConfigManager.addMuDirectoryUnit(SERVER, { id: 'mu1', name: 'Alpha again', url: 'u' });
    expect(second).toBe(false);
    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)?.units).toHaveLength(1);
  });

  it('removes a unit and reports absence', () => {
    ServerConfigManager.addMuDirectoryUnit(SERVER, { id: 'mu1', name: 'Alpha', url: 'u' });
    expect(ServerConfigManager.removeMuDirectoryUnit(SERVER, 'mu1')).toBe(true);
    expect(ServerConfigManager.removeMuDirectoryUnit(SERVER, 'mu1')).toBe(false);
    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)?.units).toHaveLength(0);
  });

  it('sets manage roles and message ids, filtering blanks', () => {
    ServerConfigManager.updateMuDirectoryConfig(SERVER, { channelId: 'chan-1' });
    ServerConfigManager.setMuDirectoryManageRoles(SERVER, ['role-1', '', '  ', 'role-2']);
    ServerConfigManager.setMuDirectoryMessageIds(SERVER, ['m1', 'm2']);

    const config = ServerConfigManager.getMuDirectoryConfig(SERVER);
    expect(config?.manageRoleIds).toEqual(['role-1', 'role-2']);
    expect(config?.messageIds).toEqual(['m1', 'm2']);
    expect(config?.channelId).toBe('chan-1');
  });

  it('round-trips through the database', async () => {
    ServerConfigManager.updateMuDirectoryConfig(SERVER, {
      channelId: 'chan-1',
      units: [{ id: 'mu1', name: 'Alpha', url: 'u' }],
      manageRoleIds: ['role-1'],
      messageIds: ['m1'],
      lastUpdated: '2026-07-09T12:00:00.000Z',
    });
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    const config = ServerConfigManager.getMuDirectoryConfig(SERVER);
    expect(config).toEqual({
      enabled: true,
      channelId: 'chan-1',
      units: [{ id: 'mu1', name: 'Alpha', url: 'u' }],
      manageRoleIds: ['role-1'],
      messageIds: ['m1'],
      lastUpdated: '2026-07-09T12:00:00.000Z',
    });
  });

  it('returns a deep copy that does not mutate the cache', () => {
    ServerConfigManager.addMuDirectoryUnit(SERVER, { id: 'mu1', name: 'Alpha', url: 'u' });
    const config = ServerConfigManager.getMuDirectoryConfig(SERVER)!;
    config.units.push({ id: 'mu2', name: 'Injected', url: 'u' });
    config.messageIds.push('leak');

    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)?.units).toHaveLength(1);
    expect(ServerConfigManager.getMuDirectoryConfig(SERVER)?.messageIds).toHaveLength(0);
  });
});
