import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import * as fs from 'fs';
import * as path from 'path';

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('ServerConfigManager', () => {
  const testConfigFilePath = path.join(process.cwd(), 'config', 'serverConfig.json');
  let originalFileContent: string | null = null;

  // Ensure config directory exists
  beforeAll(() => {
    const configDir = path.dirname(testConfigFilePath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    if (fs.existsSync(testConfigFilePath)) {
      originalFileContent = fs.readFileSync(testConfigFilePath, 'utf-8');
    }
  });

  // Restore the original file after tests
  afterAll(() => {
    if (originalFileContent) {
      fs.writeFileSync(testConfigFilePath, originalFileContent, 'utf-8');
    } else if (fs.existsSync(testConfigFilePath)) {
      fs.unlinkSync(testConfigFilePath);
    }
    ServerConfigManager.clearCache();
  });

  // Create a test file and reload cache before each test
  beforeEach(() => {
    const testConfig = {
      servers: {
        'test-server-1': {
          bountyBattles: {
            channelId: 'channel-1',
            roleIds: ['role-1', 'role-2'],
            enabled: true,
            bountyThreshold: 0,
          },
        },
        'test-server-2': {
          bountyBattles: {
            channelId: 'channel-2',
            roleIds: ['role-3'],
            enabled: false,
            bountyThreshold: 10,
          },
        },
      },
    };
    fs.writeFileSync(testConfigFilePath, JSON.stringify(testConfig, null, 2), 'utf-8');
    
    // Load the test config into memory cache
    ServerConfigManager.loadConfigs();
  });

  // Clear cache after each test
  afterEach(() => {
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

    it('should return empty map when no servers are configured', () => {
      const emptyConfig = { servers: {} };
      fs.writeFileSync(testConfigFilePath, JSON.stringify(emptyConfig, null, 2), 'utf-8');
      
      ServerConfigManager.loadConfigs();
      const configs = ServerConfigManager.readServerConfigs();

      expect(configs.size).toBe(0);
    });

    it('should throw error when file does not exist', () => {
      ServerConfigManager.clearCache();
      fs.unlinkSync(testConfigFilePath);

      expect(() => {
        ServerConfigManager.loadConfigs();
      }).toThrow();
    });

    it('should throw error when file contains invalid JSON', () => {
      ServerConfigManager.clearCache();
      fs.writeFileSync(testConfigFilePath, 'invalid json', 'utf-8');

      expect(() => {
        ServerConfigManager.loadConfigs();
      }).toThrow();
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
      const config = ServerConfigManager.getServerConfig('non-existent-server');

      expect(config).toBeUndefined();
    });
  });

  describe('updateBountyBattlesConfig', () => {
    it('should update existing server configuration', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        channelId: 'new-channel-1',
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.channelId).toBe('new-channel-1');
      expect(config?.bountyBattles?.roleIds).toEqual(['role-1', 'role-2']);
      expect(config?.bountyBattles?.enabled).toBe(true);
    });

    it('should update roleIds for existing server', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        roleIds: ['new-role-1'],
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.roleIds).toEqual(['new-role-1']);
    });

    it('should update enabled status for existing server', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        enabled: false,
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.enabled).toBe(false);
    });

    it('should create new server configuration if it does not exist', () => {
      ServerConfigManager.updateBountyBattlesConfig('new-server', {
        channelId: 'new-channel',
        roleIds: ['new-role'],
      });

      const config = ServerConfigManager.getServerConfig('new-server');
      expect(config?.bountyBattles).toEqual({
        channelId: 'new-channel',
        roleIds: ['new-role'],
        enabled: true,
        bountyThreshold: 0,
      });
    });

    it('should default to enabled:true when creating new server without specifying', () => {
      ServerConfigManager.updateBountyBattlesConfig('new-server-2', {
        channelId: 'channel-123',
        roleIds: [],
        bountyThreshold: 0,
      });

      const config = ServerConfigManager.getServerConfig('new-server-2');
      expect(config?.bountyBattles?.enabled).toBe(true);
    });

    it('should update multiple fields at once', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        channelId: 'updated-channel',
        roleIds: ['updated-role'],
        enabled: false,
        bountyThreshold: 15,
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles).toEqual({
        channelId: 'updated-channel',
        roleIds: ['updated-role'],
        enabled: false,
        bountyThreshold: 15,
      });
    });

    it('should persist changes to disk', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        channelId: 'persisted-channel',
      });

      // Read directly from disk
      const fileContent = fs.readFileSync(testConfigFilePath, 'utf-8');
      const diskConfig = JSON.parse(fileContent);

      expect(diskConfig.servers['test-server-1'].bountyBattles.channelId).toBe('persisted-channel');
    });

    it('should preserve other servers when updating one', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        channelId: 'modified-channel',
      });

      const config2 = ServerConfigManager.getServerConfig('test-server-2');
      expect(config2?.bountyBattles?.channelId).toBe('channel-2');
    });
  });

  describe('edge cases', () => {
    it('should handle empty roleIds array', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        roleIds: [],
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.roleIds).toEqual([]);
    });

    it('should handle partial updates', () => {
      ServerConfigManager.updateBountyBattlesConfig('test-server-1', {
        bountyThreshold: 25,
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.bountyBattles?.channelId).toBe('channel-1');
      expect(config?.bountyBattles?.roleIds).toEqual(['role-1', 'role-2']);
      expect(config?.bountyBattles?.bountyThreshold).toBe(25);
    });
  });
});
