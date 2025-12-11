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
  const testServersFilePath = path.join(process.cwd(), 'servers.json');
  let originalFileContent: string | null = null;

  // Backup the original file before tests
  beforeAll(() => {
    if (fs.existsSync(testServersFilePath)) {
      originalFileContent = fs.readFileSync(testServersFilePath, 'utf-8');
    }
  });

  // Restore the original file after tests
  afterAll(() => {
    if (originalFileContent) {
      fs.writeFileSync(testServersFilePath, originalFileContent, 'utf-8');
    }
    ServerConfigManager.clearCache();
  });

  // Create a test file and reload cache before each test
  beforeEach(() => {
    const testConfig = {
      servers: {
        'test-server-1': {
          channelId: 'channel-1',
          roleIds: ['role-1', 'role-2'],
          enabled: true,
        },
        'test-server-2': {
          channelId: 'channel-2',
          roleIds: ['role-3'],
          enabled: false,
        },
      },
    };
    fs.writeFileSync(testServersFilePath, JSON.stringify(testConfig, null, 2), 'utf-8');
    
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
        channelId: 'channel-1',
        roleIds: ['role-1', 'role-2'],
        enabled: true,
      });
      expect(configs.get('test-server-2')).toEqual({
        channelId: 'channel-2',
        roleIds: ['role-3'],
        enabled: false,
      });
    });

    it('should return empty map when no servers are configured', () => {
      const emptyConfig = { servers: {} };
      fs.writeFileSync(testServersFilePath, JSON.stringify(emptyConfig, null, 2), 'utf-8');
      
      ServerConfigManager.loadConfigs();
      const configs = ServerConfigManager.readServerConfigs();

      expect(configs.size).toBe(0);
    });

    it('should throw error when file does not exist', () => {
      ServerConfigManager.clearCache();
      fs.unlinkSync(testServersFilePath);

      expect(() => {
        ServerConfigManager.loadConfigs();
      }).toThrow();
    });

    it('should throw error when file contains invalid JSON', () => {
      ServerConfigManager.clearCache();
      fs.writeFileSync(testServersFilePath, 'invalid json', 'utf-8');

      expect(() => {
        ServerConfigManager.loadConfigs();
      }).toThrow();
    });
  });

  describe('getServerConfig', () => {
    it('should get configuration for a specific server', () => {
      const config = ServerConfigManager.getServerConfig('test-server-1');

      expect(config).toEqual({
        channelId: 'channel-1',
        roleIds: ['role-1', 'role-2'],
        enabled: true,
      });
    });

    it('should return undefined for non-existent server', () => {
      const config = ServerConfigManager.getServerConfig('non-existent-server');

      expect(config).toBeUndefined();
    });
  });

  describe('updateServerConfig', () => {
    it('should update existing server configuration', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        channelId: 'new-channel-1',
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config).toEqual({
        channelId: 'new-channel-1',
        roleIds: ['role-1', 'role-2'], // Should preserve existing roleIds
        enabled: true, // Should preserve existing enabled
      });
    });

    it('should update roleIds for existing server', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        roleIds: ['new-role-1'],
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config).toEqual({
        channelId: 'channel-1', // Should preserve existing channelId
        roleIds: ['new-role-1'],
        enabled: true, // Should preserve existing enabled
      });
    });

    it('should update enabled status for existing server', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        enabled: false,
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config).toEqual({
        channelId: 'channel-1', // Should preserve existing channelId
        roleIds: ['role-1', 'role-2'], // Should preserve existing roleIds
        enabled: false,
      });
    });

    it('should create new server configuration if it does not exist', () => {
      ServerConfigManager.updateServerConfig('new-server', {
        channelId: 'new-channel',
        roleIds: ['new-role'],
        enabled: true,
      });

      const config = ServerConfigManager.getServerConfig('new-server');
      expect(config).toEqual({
        channelId: 'new-channel',
        roleIds: ['new-role'],
        enabled: true,
      });
    });

    it('should default to enabled:true when creating new server without specifying', () => {
      ServerConfigManager.updateServerConfig('new-server-2', {
        channelId: 'channel-x',
        roleIds: [],
      });

      const config = ServerConfigManager.getServerConfig('new-server-2');
      expect(config?.enabled).toBe(true);
    });

    it('should update multiple fields at once', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        channelId: 'updated-channel',
        roleIds: ['updated-role'],
        enabled: false,
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config).toEqual({
        channelId: 'updated-channel',
        roleIds: ['updated-role'],
        enabled: false,
      });
    });

    it('should persist changes to disk', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        channelId: 'persisted-channel',
      });

      // Read directly from file to verify persistence
      const fileContent = fs.readFileSync(testServersFilePath, 'utf-8');
      const config = JSON.parse(fileContent);

      expect(config.servers['test-server-1'].channelId).toBe('persisted-channel');
    });

    it('should preserve other servers when updating one', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        channelId: 'modified-channel',
      });

      const config2 = ServerConfigManager.getServerConfig('test-server-2');
      expect(config2).toEqual({
        channelId: 'channel-2',
        roleIds: ['role-3'],
        enabled: false,
      });
    });
  });

  describe('edge cases', () => {
    it('should handle empty roleIds array', () => {
      ServerConfigManager.updateServerConfig('test-server-1', {
        roleIds: [],
      });

      const config = ServerConfigManager.getServerConfig('test-server-1');
      expect(config?.roleIds).toEqual([]);
    });

    it('should handle partial updates', () => {
      const originalConfig = ServerConfigManager.getServerConfig('test-server-1');
      
      ServerConfigManager.updateServerConfig('test-server-1', {
        enabled: false,
      });

      const updatedConfig = ServerConfigManager.getServerConfig('test-server-1');
      expect(updatedConfig?.channelId).toBe(originalConfig?.channelId);
      expect(updatedConfig?.roleIds).toEqual(originalConfig?.roleIds);
      expect(updatedConfig?.enabled).toBe(false);
    });
  });
});
