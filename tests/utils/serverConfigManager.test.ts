import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import { prisma } from '../../src/persistence/prisma';
import { pushTestSchema, clearTables } from '../setup/testDb';

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

/** Seed a server row directly in the database (bypassing the manager). */
async function seedServer(id: string, bountyBattles: unknown): Promise<void> {
  await prisma.server.create({
    data: { id, bountyBattles: JSON.stringify(bountyBattles) },
  });
}

describe('ServerConfigManager', () => {
  beforeAll(() => {
    pushTestSchema();
  });

  afterAll(async () => {
    ServerConfigManager.clearCache();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Drain any fire-and-forget persist scheduled by a previous test before resetting.
    await ServerConfigManager.flush();
    await clearTables();
    await seedServer('test-server-1', {
      channelId: 'channel-1',
      roleIds: ['role-1', 'role-2'],
      enabled: true,
      bountyThreshold: 0,
    });
    await seedServer('test-server-2', {
      channelId: 'channel-2',
      roleIds: ['role-3'],
      enabled: false,
      bountyThreshold: 10,
    });
    await ServerConfigManager.loadConfigs();
  });

  afterEach(async () => {
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
  });

  describe('readServerConfigs', () => {
    it('should read all server configurations', () => {
      const configs = ServerConfigManager.readServerConfigs();

      expect(configs.size).toBe(2);
      expect(configs.get('test-server-1')).toEqual({
        bountyBattles: {
          channelId: 'channel-1',
          roleIds: ['role-1', 'role-2'],
          enabled: true,
          bountyThreshold: 0,
        },
        reports: undefined,
        userTracking: undefined,
        countryGroups: [],
      });
      expect(configs.get('test-server-2')).toEqual({
        bountyBattles: {
          channelId: 'channel-2',
          roleIds: ['role-3'],
          enabled: false,
          bountyThreshold: 10,
        },
        reports: undefined,
        userTracking: undefined,
        countryGroups: [],
      });
    });

    it('should return empty map when no servers are configured', async () => {
      await clearTables();
      await ServerConfigManager.loadConfigs();

      expect(ServerConfigManager.readServerConfigs().size).toBe(0);
    });
  });

  describe('getServerConfig', () => {
    it('should get configuration for a specific server', () => {
      const config = ServerConfigManager.getServerConfig('test-server-1');

      expect(config).toEqual({
        bountyBattles: {
          channelId: 'channel-1',
          roleIds: ['role-1', 'role-2'],
          enabled: true,
          bountyThreshold: 0,
        },
        reports: undefined,
        userTracking: undefined,
        countryGroups: [],
      });
    });

    it('should return undefined for non-existent server', () => {
      expect(ServerConfigManager.getServerConfig('non-existent-server')).toBeUndefined();
    });
  });

  describe('updateBountyBattlesConfig', () => {
    it('should update existing server configuration', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', { channelId: 'new-channel-1' });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.channelId).toBe('new-channel-1');
      expect(config?.bountyBattles?.roleIds).toEqual(['role-1', 'role-2']);
      expect(config?.bountyBattles?.enabled).toBe(true);
    });

    it('should create new server configuration if it does not exist', () => {
      ServerConfigManager.updateBountyBattlesConfig('new-server', {
        channelId: 'new-channel',
        roleIds: ['new-role'],
      });

      expect(ServerConfigManager.getServerConfig('new-server')?.bountyBattles).toEqual({
        channelId: 'new-channel',
        roleIds: ['new-role'],
        enabled: true,
        bountyThreshold: 0,
      });
    });

    it('should update multiple fields at once', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        channelId: 'updated-channel',
        roleIds: ['updated-role'],
        enabled: false,
        bountyThreshold: 15,
      });

      expect(ServerConfigManager.getServerConfig('test-server-1')?.bountyBattles).toEqual({
        channelId: 'updated-channel',
        roleIds: ['updated-role'],
        enabled: false,
        bountyThreshold: 15,
      });
    });

    it('should persist changes to the database', async () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', { channelId: 'persisted-channel' });
      await ServerConfigManager.flush();

      const row = await prisma.server.findUnique({ where: { id: 'test-server-1' } });
      const bountyBattles = JSON.parse(row!.bountyBattles!);
      expect(bountyBattles.channelId).toBe('persisted-channel');
    });

    it('should preserve other servers when updating one', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', { channelId: 'modified-channel' });

      expect(ServerConfigManager.getServerConfig('test-server-2')?.bountyBattles?.channelId).toBe('channel-2');
    });

    it('should round-trip an update through a reload', async () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', { channelId: 'reloaded-channel' });
      await ServerConfigManager.flush();
      await ServerConfigManager.reloadConfigs();

      expect(ServerConfigManager.getServerConfig('test-server-1')?.bountyBattles?.channelId).toBe('reloaded-channel');
    });
  });

  describe('edge cases', () => {
    it('should handle empty roleIds array', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', { roleIds: [] });
      expect(ServerConfigManager.getServerConfig('test-server-1')?.bountyBattles?.roleIds).toEqual([]);
    });

    it('should handle partial updates', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', { bountyThreshold: 25 });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.channelId).toBe('channel-1');
      expect(config?.bountyBattles?.roleIds).toEqual(['role-1', 'role-2']);
      expect(config?.bountyBattles?.bountyThreshold).toBe(25);
    });
  });
});
