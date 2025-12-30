import * as fs from 'fs';
import * as path from 'path';
import { ServerConfig, BountyBattlesConfig, TrackedUser } from '../config/config';
import { logger } from './logger';

/**
 * Structure of the serverConfig.json file
 */
interface ServerConfigJsonStructure {
  servers: Record<string, ServerConfig>;
}

/**
 * Manager for reading and writing server configurations to serverConfig.json
 * Uses an in-memory cache for efficiency
 */
export class ServerConfigManager {
  private static readonly CONFIG_FILE_PATH = path.join(process.cwd(), '/config/serverConfig.json');
  private static configCache: Map<string, ServerConfig> | null = null;

  /**
   * Load server configurations from disk into memory cache
   * Should be called once at bot startup
   */
  static loadConfigs(): void {
    if (!fs.existsSync(this.CONFIG_FILE_PATH)) {
      throw new Error(
        `serverConfig.json file not found at ${this.CONFIG_FILE_PATH}. ` +
        `Please create it based on serverConfig.json.example`
      );
    }

    try {
      const fileContent = fs.readFileSync(this.CONFIG_FILE_PATH, 'utf-8');
      const config = JSON.parse(fileContent) as ServerConfigJsonStructure;

      if (!config.servers || typeof config.servers !== 'object') {
        throw new Error('serverConfig.json must contain a "servers" object');
      }

      const serversMap = new Map<string, ServerConfig>();

      for (const [serverId, serverConfig] of Object.entries(config.servers || {})) {
        // Validate bountyBattles config if present
        if (serverConfig.bountyBattles) {
          if (!serverConfig.bountyBattles.channelId) {
            throw new Error(`Server ${serverId} bountyBattles is missing channelId`);
          }
          if (!Array.isArray(serverConfig.bountyBattles.roleIds)) {
            throw new Error(`Server ${serverId} bountyBattles roleIds must be an array`);
          }
        }

        serversMap.set(serverId, {
          bountyBattles: serverConfig.bountyBattles ? {
            channelId: serverConfig.bountyBattles.channelId,
            roleIds: serverConfig.bountyBattles.roleIds.filter(id => id && id.trim().length > 0),
            enabled: serverConfig.bountyBattles.enabled,
            bountyThreshold: serverConfig.bountyBattles.bountyThreshold,
          } : undefined,
          reports: serverConfig.reports,
          userTracking: serverConfig.userTracking ? {
            enabled: serverConfig.userTracking.enabled,
            users: serverConfig.userTracking.users || [],
          } : undefined,
        });
      }

      // Allow empty server configuration for initial setup
      if (serversMap.size === 0) {
        logger.warn('No servers configured in serverConfig.json. Use /bountybattles config set to configure servers.');
      }

      this.configCache = serversMap;
      logger.info(`Loaded ${serversMap.size} server configuration(s) into memory`);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in serverConfig.json: ${error.message}`);
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
   * Update bounty battles configuration for a specific server
   * Creates a new entry if the server doesn't exist
   * Updates both in-memory cache and disk
   */
  static updateBountyBattlesConfig(serverId: string, config: Partial<BountyBattlesConfig>): void {
    try {
      // Ensure cache is loaded
      if (this.configCache === null) {
        this.loadConfigs();
      }
      
      // Get existing config or create new one
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingBountyConfig = existingServerConfig.bountyBattles || {
        channelId: '',
        roleIds: [],
        enabled: true,
        bountyThreshold: 0,
      };

      // Merge with new config
      const updatedBountyConfig: BountyBattlesConfig = {
        channelId: config.channelId !== undefined ? config.channelId : existingBountyConfig.channelId,
        roleIds: config.roleIds !== undefined ? config.roleIds : existingBountyConfig.roleIds,
        enabled: config.enabled !== undefined ? config.enabled : existingBountyConfig.enabled,
        bountyThreshold: config.bountyThreshold !== undefined ? config.bountyThreshold : existingBountyConfig.bountyThreshold,
      };

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        bountyBattles: updatedBountyConfig,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Updated bounty battles config for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update bounty battles config', error);
      throw error;
    }
  }

  /**
   * Legacy method for backward compatibility
   * @deprecated Use updateBountyBattlesConfig instead
   */
  static updateServerConfig(serverId: string, config: Partial<BountyBattlesConfig>): void {
    this.updateBountyBattlesConfig(serverId, config);
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

    const fileContent: ServerConfigJsonStructure = {
      servers: serversObject,
    };

    fs.writeFileSync(
      this.CONFIG_FILE_PATH,
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
    if (!config) return undefined;
    
    return {
      bountyBattles: config.bountyBattles ? {
        ...config.bountyBattles,
        roleIds: [...config.bountyBattles.roleIds],
      } : undefined,
      reports: config.reports ? { ...config.reports } : undefined,
      userTracking: config.userTracking ? {
        ...config.userTracking,
        users: config.userTracking.users.map(u => ({ ...u })),
      } : undefined,
    };
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

  /**
   * Add a user to track for a specific server
   */
  static addTrackedUser(serverId: string, user: TrackedUser): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingUserTracking = existingServerConfig.userTracking || {
        enabled: true,
        users: [],
      };

      // Check if user is already being tracked
      const existingUserIndex = existingUserTracking.users.findIndex(u => u.userId === user.userId);
      
      if (existingUserIndex !== -1) {
        // Update existing user
        existingUserTracking.users[existingUserIndex] = user;
      } else {
        // Add new user
        existingUserTracking.users.push(user);
      }

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        userTracking: existingUserTracking,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Added/updated tracked user ${user.userId} for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to add tracked user', error);
      throw error;
    }
  }

  /**
   * Remove a tracked user from a specific server
   */
  static removeTrackedUser(serverId: string, userId: string): boolean {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.userTracking) {
        logger.warn(`No user tracking config found for server ${serverId}`);
        return false;
      }

      const initialLength = existingServerConfig.userTracking.users.length;
      existingServerConfig.userTracking.users = existingServerConfig.userTracking.users.filter(
        u => u.userId !== userId
      );

      if (existingServerConfig.userTracking.users.length === initialLength) {
        logger.warn(`User ${userId} not found in tracking for server ${serverId}`);
        return false;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Removed tracked user ${userId} from server ${serverId}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove tracked user', error);
      throw error;
    }
  }

  /**
   * Update tracking status for a user (lastChecked, lastActive, reported)
   */
  static updateTrackedUserStatus(
    serverId: string, 
    userId: string, 
    lastChecked: string, 
    lastActive?: string,
    reported?: boolean
  ): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.userTracking) {
        logger.warn(`No user tracking config found for server ${serverId}`);
        return;
      }

      const user = existingServerConfig.userTracking.users.find(u => u.userId === userId);
      
      if (!user) {
        logger.warn(`User ${userId} not found in tracking for server ${serverId}`);
        return;
      }

      user.lastChecked = lastChecked;
      if (lastActive !== undefined) {
        user.lastActive = lastActive;
      }
      if (reported !== undefined) {
        user.reported = reported;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.debug(`Updated tracking status for user ${userId} in server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update tracked user status', error);
      throw error;
    }
  }

  /**
   * Get all tracked users for a specific server
   */
  static getTrackedUsers(serverId: string): TrackedUser[] {
    const config = this.getServerConfig(serverId);
    return config?.userTracking?.users || [];
  }
}
