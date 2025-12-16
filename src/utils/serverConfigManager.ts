import * as fs from 'fs';
import * as path from 'path';
import { ServerConfig } from '../config/config';
import { logger } from './logger';

/**
 * Structure of the servers.json file
 */
interface ServersJsonStructure {
  servers: Record<string, ServerConfig>;
}

/**
 * Manager for reading and writing server configurations to servers.json
 * Uses an in-memory cache for efficiency
 */
export class ServerConfigManager {
  private static readonly SERVERS_FILE_PATH = path.join(process.cwd(), '/config/servers.json');
  private static configCache: Map<string, ServerConfig> | null = null;

  /**
   * Load server configurations from disk into memory cache
   * Should be called once at bot startup
   */
  static loadConfigs(): void {
    if (!fs.existsSync(this.SERVERS_FILE_PATH)) {
      throw new Error(
        `servers.json file not found at ${this.SERVERS_FILE_PATH}. ` +
        `Please create it based on servers.json.example`
      );
    }

    try {
      const fileContent = fs.readFileSync(this.SERVERS_FILE_PATH, 'utf-8');
      const config = JSON.parse(fileContent) as ServersJsonStructure;

      if (!config.servers || typeof config.servers !== 'object') {
        throw new Error('servers.json must contain a "servers" object');
      }

      const serversMap = new Map<string, ServerConfig>();

      for (const [serverId, serverConfig] of Object.entries(config.servers || {})) {
        if (!serverConfig.channelId) {
          throw new Error(`Server ${serverId} is missing channelId`);
        }

        if (!Array.isArray(serverConfig.roleIds)) {
          throw new Error(`Server ${serverId} roleIds must be an array`);
        }

        serversMap.set(serverId, {
          channelId: serverConfig.channelId,
          roleIds: serverConfig.roleIds.filter(id => id && id.trim().length > 0),
          enabled: serverConfig.enabled,
          bountyThreshold: serverConfig.bountyThreshold,
        });
      }

      // Allow empty server configuration for initial setup
      if (serversMap.size === 0) {
        logger.warn('No servers configured in servers.json. Use /bountybattles config set to configure servers.');
      }

      this.configCache = serversMap;
      logger.info(`Loaded ${serversMap.size} server configuration(s) into memory`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in servers.json: ${error.message}`);
      }
      logger.error('Failed to load server configs from disk', error);
      throw error;
    }
  }

  /**
   * Read all server configurations from memory cache
   * If cache is not initialized, loads it first
   */
  static readServerConfigs(): Map<string, ServerConfig> {
    if (this.configCache === null) {
      logger.warn('Config cache not initialized, loading from disk');
      this.loadConfigs();
    }
    
    // Return a copy to prevent external modifications
    return new Map(this.configCache);
  }

  /**
   * Update configuration for a specific server
   * Creates a new entry if the server doesn't exist
   * Updates both in-memory cache and disk
   */
  static updateServerConfig(serverId: string, config: Partial<ServerConfig>): void {
    try {
      // Ensure cache is loaded
      if (this.configCache === null) {
        this.loadConfigs();
      }
      
      // Get existing config or create new one
      const existingConfig = this.configCache!.get(serverId) || {
        channelId: '',
        roleIds: [],
        enabled: true,
        bountyThreshold: 0,
      };

      // Merge with new config
      const updatedConfig: ServerConfig = {
        channelId: config.channelId !== undefined ? config.channelId : existingConfig.channelId,
        roleIds: config.roleIds !== undefined ? config.roleIds : existingConfig.roleIds,
        enabled: config.enabled !== undefined ? config.enabled : existingConfig.enabled,
        bountyThreshold: config.bountyThreshold !== undefined ? config.bountyThreshold : existingConfig.bountyThreshold,
      };

      // Update in-memory cache
      this.configCache!.set(serverId, updatedConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Updated server config for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update server config', error);
      throw error;
    }
  }

  /**
   * Write the current in-memory cache to disk
   * @private
   */
  private static writeConfigsToDisk(): void {
    if (this.configCache === null) {
      throw new Error('Cannot write configs to disk: cache not initialized');
    }

    // Convert map to object
    const serversObject: Record<string, ServerConfig> = {};
    for (const [id, cfg] of this.configCache.entries()) {
      serversObject[id] = cfg;
    }

    const fileContent: ServersJsonStructure = {
      servers: serversObject,
    };

    fs.writeFileSync(
      this.SERVERS_FILE_PATH,
      JSON.stringify(fileContent, null, 2),
      'utf-8'
    );
  }

  /**
   * Get configuration for a specific server from memory cache
   */
  static getServerConfig(serverId: string): ServerConfig | undefined {
    if (this.configCache === null) {
      logger.warn('Config cache not initialized, loading from disk');
      this.loadConfigs();
    }
    
    const config = this.configCache!.get(serverId);
    // Return a copy to prevent external modifications
    return config ? { ...config, roleIds: [...config.roleIds] } : undefined;
  }

  /**
   * Reload configurations from disk into memory cache
   * Useful for external file changes or testing
   */
  static reloadConfigs(): void {
    logger.info('Reloading server configurations from disk');
    this.loadConfigs();
  }

  /**
   * Clear the in-memory cache
   * Mainly for testing purposes
   */
  static clearCache(): void {
    this.configCache = null;
    logger.debug('Server config cache cleared');
  }
}
