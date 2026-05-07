/// <reference types="jest" />
import { loadConfig } from '../../src/config/config';
import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import * as fs from 'fs';

// Mock fs module
jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

// Mock process.env
const originalEnv = process.env;

describe('Config', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    ServerConfigManager.clearCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    ServerConfigManager.clearCache();
  });

  describe('loadConfig', () => {
    it('should load valid configuration', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';
      process.env.API_BASE_URL = 'https://api.test.com';

      const serversConfig = {
        servers: {
          'server1': {
            bountyBattles: {
              channelId: 'channel1',
              roleIds: ['role1', 'role2'],
              enabled: true,
              bountyThreshold: 0,
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(serversConfig));

      const config = loadConfig();

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

    it('should throw error when DISCORD_TOKEN is missing', () => {
      delete process.env.DISCORD_TOKEN;
      process.env.POLLING_INTERVAL_MINUTES = '5';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ servers: {} }));

      expect(() => loadConfig()).toThrow('DISCORD_TOKEN environment variable is required');
    });

    it('should throw error when POLLING_INTERVAL_MINUTES is missing', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      delete process.env.POLLING_INTERVAL_MINUTES;

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ servers: {} }));

      expect(() => loadConfig()).toThrow('POLLING_INTERVAL_MINUTES environment variable is required');
    });

    it('should throw error when servers.json is missing', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';

      mockFs.existsSync.mockReturnValue(false);

      expect(() => loadConfig()).toThrow('serverConfig.json file not found');
    });

    it('should throw error when servers.json is invalid JSON', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue('invalid json');

      expect(() => loadConfig()).toThrow();
    });

    it('should throw error for invalid polling interval', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = 'invalid';

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ servers: {} }));

      expect(() => loadConfig()).toThrow('POLLING_INTERVAL_MINUTES must be a positive number');
    });

    it('should handle servers with no role IDs', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';

      const serversConfig = {
        servers: {
          'server1': {
            bountyBattles: {
              channelId: 'channel1',
              roleIds: [],
              enabled: true,
              bountyThreshold: 0,
            },
          },
        },
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(serversConfig));

      const config = loadConfig();

      expect(config.discord.servers.get('server1')?.bountyBattles?.roleIds).toEqual([]);
    });

    it('should allow empty servers configuration', () => {
      process.env.DISCORD_TOKEN = 'test-token';
      process.env.POLLING_INTERVAL_MINUTES = '5';

      const serversConfig = {
        servers: {},
      };

      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(serversConfig));

      const config = loadConfig();

      expect(config.discord.servers.size).toBe(0);
      expect(config.discord.token).toBe('test-token');
      expect(config.polling.intervalMinutes).toBe(5);
    });
  });
});

