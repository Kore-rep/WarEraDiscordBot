import { loadConfig } from '../../src/config/config';
import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import { prisma } from '../../src/persistence/prisma';
import { pushTestSchema, clearTables } from '../setup/testDb';

const originalEnv = process.env;

describe('Config', () => {
  beforeAll(() => {
    pushTestSchema();
  });

  afterAll(async () => {
    ServerConfigManager.clearCache();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    ServerConfigManager.clearCache();
    await clearTables();
  });

  afterEach(() => {
    process.env = originalEnv;
    ServerConfigManager.clearCache();
  });

  describe('loadConfig', () => {
    it('should load valid configuration', async () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';
      process.env.API_BASE_URL = 'https://api.test.com';

      await prisma.server.create({
        data: {
          id: 'server1',
          bountyBattles: JSON.stringify({
            channelId: 'channel1',
            roleIds: ['role1', 'role2'],
            enabled: true,
            bountyThreshold: 0,
          }),
        },
      });

      const config = await loadConfig();

      expect(config.discord.token).toBe('test-token');
      expect(config.polling.intervalMinutes).toBe(5);
      expect(config.api.baseUrl).toBe('https://api.test.com');
      expect(config.discord.servers.size).toBe(1);
      expect(config.discord.servers.get('server1')).toEqual({
        bountyBattles: {
          channelId: 'channel1',
          roleIds: ['role1', 'role2'],
          enabled: true,
          bountyThreshold: 0,
        },
        reports: undefined,
        userTracking: undefined,
        countryGroups: [],
      });
    });

    it('should throw error when DISCORD_TOKEN is missing', async () => {
      delete process.env.DISCORD_TOKEN;
      process.env.POLLING_INTERVAL_MINUTES = '5';

      await expect(loadConfig()).rejects.toThrow('DISCORD_TOKEN environment variable is required');
    });

    it('should throw error when POLLING_INTERVAL_MINUTES is missing', async () => {
      process.env.DISCORD_TOKEN = 'test-token';
      delete process.env.POLLING_INTERVAL_MINUTES;

      await expect(loadConfig()).rejects.toThrow('POLLING_INTERVAL_MINUTES environment variable is required');
    });

    it('should throw error for invalid polling interval', async () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = 'invalid';

      await expect(loadConfig()).rejects.toThrow('POLLING_INTERVAL_MINUTES must be a positive number');
    });

    it('should handle servers with no role IDs', async () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';

      await prisma.server.create({
        data: {
          id: 'server1',
          bountyBattles: JSON.stringify({ channelId: 'channel1', roleIds: [], enabled: true, bountyThreshold: 0 }),
        },
      });

      const config = await loadConfig();
      expect(config.discord.servers.get('server1')?.bountyBattles?.roleIds).toEqual([]);
    });

    it('should allow empty servers configuration', async () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';

      const config = await loadConfig();

      expect(config.discord.servers.size).toBe(0);
      expect(config.discord.token).toBe('test-token');
      expect(config.polling.intervalMinutes).toBe(5);
    });
  });
});
