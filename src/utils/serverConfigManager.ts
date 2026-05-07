import * as fs from 'fs';
import * as path from 'path';
import {
  ServerConfig,
  BountyBattlesConfig,
  TrackedUser,
  CountryGroup,
  GroupedCountry,
  SpectreCountryMonitorEntry,
} from '../config/config';
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

        // Validate mercenaryContracts config if present
        if (serverConfig.mercenaryContracts) {
          if (!serverConfig.mercenaryContracts.channelId) {
            throw new Error(`Server ${serverId} mercenaryContracts is missing channelId`);
          }
          if (!Array.isArray(serverConfig.mercenaryContracts.roleIds)) {
            throw new Error(`Server ${serverId} mercenaryContracts roleIds must be an array`);
          }
        }

        const validateSpectreMonitors = (arr: SpectreCountryMonitorEntry[] | undefined, label: string) => {
          if (!arr) {
            return;
          }
          if (!Array.isArray(arr)) {
            throw new Error(`Server ${serverId} spectre.${label} must be an array`);
          }
          for (const m of arr) {
            if (!m.countryId?.trim() || !m.countryName?.trim() || !m.channelId?.trim()) {
              throw new Error(`Server ${serverId} spectre ${label} entry is missing countryId, countryName, or channelId`);
            }
          }
        };
        validateSpectreMonitors(serverConfig.spectre?.buildingMonitors, 'buildingMonitors');
        validateSpectreMonitors(serverConfig.spectre?.resistanceMonitors, 'resistanceMonitors');

        serversMap.set(serverId, {
          bountyBattles: serverConfig.bountyBattles ? {
            channelId: serverConfig.bountyBattles.channelId,
            roleIds: serverConfig.bountyBattles.roleIds.filter(id => id && id.trim().length > 0),
            enabled: serverConfig.bountyBattles.enabled,
            bountyThreshold: serverConfig.bountyBattles.bountyThreshold,
            minBountyToSend: serverConfig.bountyBattles.minBountyToSend,
          } : undefined,
          mercenaryContracts: serverConfig.mercenaryContracts ? {
            channelId: serverConfig.mercenaryContracts.channelId,
            roleIds: serverConfig.mercenaryContracts.roleIds.filter(id => id && id.trim().length > 0),
            enabled: serverConfig.mercenaryContracts.enabled,
            contractThreshold: serverConfig.mercenaryContracts.contractThreshold,
            minContractToSend: serverConfig.mercenaryContracts.minContractToSend,
          } : undefined,
          reports: serverConfig.reports,
          userTracking: serverConfig.userTracking ? {
            enabled: serverConfig.userTracking.enabled,
            users: serverConfig.userTracking.users || [],
          } : undefined,
          countryGroups: serverConfig.countryGroups || [],
          spectre: serverConfig.spectre ? {
            buildingMonitors: (serverConfig.spectre.buildingMonitors || []).map(m => ({
              countryId: m.countryId,
              countryName: m.countryName,
              channelId: m.channelId,
              enabled: m.enabled !== false,
            })),
            resistanceMonitors: (serverConfig.spectre.resistanceMonitors || []).map(m => ({
              countryId: m.countryId,
              countryName: m.countryName,
              channelId: m.channelId,
              enabled: m.enabled !== false,
            })),
          } : undefined,
        });
      }

      // Allow empty server configuration for initial setup
      if (serversMap.size === 0) {
        logger.warn('No servers configured in serverConfig.json. Use /bountybattles config set or /contracts config set to configure servers.');
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
        minBountyToSend: config.minBountyToSend !== undefined ? config.minBountyToSend : existingBountyConfig.minBountyToSend,
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
   * Update mercenary contract configuration for a server
   * @param serverId Discord server ID
   * @param config Partial mercenary contract configuration to update
   */
  static updateMercenaryContractsConfig(serverId: string, config: Partial<import('../config/config').MercenaryContractsConfig>): void {
    try {
      // Ensure cache is loaded
      if (this.configCache === null) {
        this.loadConfigs();
      }
      
      // Get existing config or create new one
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingMercenaryConfig = existingServerConfig.mercenaryContracts || {
        channelId: '',
        roleIds: [],
        enabled: true,
        contractThreshold: 0,
      };

      // Merge with new config
      const updatedMercenaryConfig: import('../config/config').MercenaryContractsConfig = {
        channelId: config.channelId !== undefined ? config.channelId : existingMercenaryConfig.channelId,
        roleIds: config.roleIds !== undefined ? config.roleIds : existingMercenaryConfig.roleIds,
        enabled: config.enabled !== undefined ? config.enabled : existingMercenaryConfig.enabled,
        contractThreshold: config.contractThreshold !== undefined ? config.contractThreshold : existingMercenaryConfig.contractThreshold,
        minContractToSend: config.minContractToSend !== undefined ? config.minContractToSend : existingMercenaryConfig.minContractToSend,
      };

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        mercenaryContracts: updatedMercenaryConfig,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Updated mercenary contracts config for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update mercenary contracts config', error);
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
      mercenaryContracts: config.mercenaryContracts ? {
        ...config.mercenaryContracts,
        roleIds: [...config.mercenaryContracts.roleIds],
      } : undefined,
      reports: config.reports ? { ...config.reports } : undefined,
      userTracking: config.userTracking ? {
        ...config.userTracking,
        users: config.userTracking.users.map(u => ({ ...u })),
      } : undefined,
      countryGroups: config.countryGroups ? config.countryGroups.map(g => ({
        ...g,
        countries: g.countries.map(c => ({ ...c })),
      })) : [],
      spectre: config.spectre ? {
        buildingMonitors: (config.spectre.buildingMonitors || []).map(m => ({ ...m })),
        resistanceMonitors: (config.spectre.resistanceMonitors || []).map(m => ({ ...m })),
      } : undefined,
    };
  }

  /**
   * Add or update a Spectre border building monitor for a server
   */
  static upsertSpectreBuildingMonitor(serverId: string, entry: SpectreCountryMonitorEntry): void {
    try {
      if (this.configCache === null) {
        this.loadConfigs();
      }

      const existingServerConfig = this.configCache!.get(serverId) || {};
      const spectre = existingServerConfig.spectre || {
        buildingMonitors: [],
        resistanceMonitors: [],
      };
      const monitors = [...spectre.buildingMonitors];
      const idx = monitors.findIndex(m => m.countryId === entry.countryId);
      if (idx >= 0) {
        monitors[idx] = entry;
      } else {
        monitors.push(entry);
      }

      this.configCache!.set(serverId, {
        ...existingServerConfig,
        spectre: {
          buildingMonitors: monitors,
          resistanceMonitors: spectre.resistanceMonitors,
        },
      });

      this.writeConfigsToDisk();
      logger.info(`Upserted Spectre building monitor for country ${entry.countryId} on server ${serverId}`);
    } catch (error) {
      logger.error('Failed to upsert Spectre building monitor', error);
      throw error;
    }
  }

  /**
   * Add or update a Spectre resistance monitor for a server
   */
  static upsertSpectreResistanceMonitor(serverId: string, entry: SpectreCountryMonitorEntry): void {
    try {
      if (this.configCache === null) {
        this.loadConfigs();
      }

      const existingServerConfig = this.configCache!.get(serverId) || {};
      const spectre = existingServerConfig.spectre || {
        buildingMonitors: [],
        resistanceMonitors: [],
      };
      const monitors = [...spectre.resistanceMonitors];
      const idx = monitors.findIndex(m => m.countryId === entry.countryId);
      if (idx >= 0) {
        monitors[idx] = entry;
      } else {
        monitors.push(entry);
      }

      this.configCache!.set(serverId, {
        ...existingServerConfig,
        spectre: {
          buildingMonitors: spectre.buildingMonitors,
          resistanceMonitors: monitors,
        },
      });

      this.writeConfigsToDisk();
      logger.info(`Upserted Spectre resistance monitor for country ${entry.countryId} on server ${serverId}`);
    } catch (error) {
      logger.error('Failed to upsert Spectre resistance monitor', error);
      throw error;
    }
  }

  /**
   * Remove Spectre monitors (buildings and/or resistance) for a country by id or case-insensitive name.
   * @returns removed country id, or null if none matched
   */
  static removeSpectreMonitorByCountry(serverId: string, countryIdOrName: string): string | null {
    try {
      if (this.configCache === null) {
        this.loadConfigs();
      }

      const existingServerConfig = this.configCache!.get(serverId);
      const spectre = existingServerConfig?.spectre;
      if (!spectre) {
        return null;
      }

      const trimmed = countryIdOrName.trim();
      const needle = trimmed.toLowerCase();
      const match = (m: SpectreCountryMonitorEntry) =>
        m.countryId === trimmed || m.countryName.toLowerCase() === needle;

      const inBuildings = spectre.buildingMonitors.find(match);
      const inResistance = spectre.resistanceMonitors.find(match);
      const removed = inBuildings || inResistance;
      if (!removed) {
        return null;
      }

      const countryId = removed.countryId;
      const buildingMonitors = spectre.buildingMonitors.filter(m => m.countryId !== countryId);
      const resistanceMonitors = spectre.resistanceMonitors.filter(m => m.countryId !== countryId);

      this.configCache!.set(serverId, {
        ...existingServerConfig,
        spectre: {
          buildingMonitors,
          resistanceMonitors,
        },
      });

      this.writeConfigsToDisk();
      logger.info(`Removed Spectre monitor(s) for ${countryId} on server ${serverId}`);
      return countryId;
    } catch (error) {
      logger.error('Failed to remove Spectre monitor', error);
      throw error;
    }
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

  /**
   * Get all country groups for a specific server
   */
  static getCountryGroups(serverId: string): CountryGroup[] {
    const config = this.getServerConfig(serverId);
    return config?.countryGroups || [];
  }

  /**
   * Get a specific country group by name for a server
   */
  static getCountryGroup(serverId: string, groupName: string): CountryGroup | undefined {
    const groups = this.getCountryGroups(serverId);
    return groups.find(g => g.name.toLowerCase() === groupName.toLowerCase());
  }

  /**
   * Create a new country group for a server
   */
  static createCountryGroup(serverId: string, group: CountryGroup): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingGroups = existingServerConfig.countryGroups || [];

      // Check if group name already exists
      const exists = existingGroups.some(g => g.name.toLowerCase() === group.name.toLowerCase());
      if (exists) {
        throw new Error(`Country group "${group.name}" already exists`);
      }

      // Add new group
      existingGroups.push(group);

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        countryGroups: existingGroups,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Created country group "${group.name}" for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to create country group', error);
      throw error;
    }
  }

  /**
   * Delete a country group from a server
   */
  static deleteCountryGroup(serverId: string, groupName: string): boolean {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      if (!existingServerConfig || !existingServerConfig.countryGroups) {
        return false;
      }

      const originalLength = existingServerConfig.countryGroups.length;
      existingServerConfig.countryGroups = existingServerConfig.countryGroups.filter(
        g => g.name.toLowerCase() !== groupName.toLowerCase()
      );

      const removed = existingServerConfig.countryGroups.length < originalLength;

      if (removed) {
        // Update in-memory cache
        this.configCache!.set(serverId, existingServerConfig);

        // Write to disk
        this.writeConfigsToDisk();

        logger.info(`Deleted country group "${groupName}" from server ${serverId}`);
      }

      return removed;
    } catch (error) {
      logger.error('Failed to delete country group', error);
      throw error;
    }
  }

  /**
   * Add countries to an existing group
   */
  static addCountriesToGroup(serverId: string, groupName: string, countries: GroupedCountry[]): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      if (!existingServerConfig || !existingServerConfig.countryGroups) {
        throw new Error('Country group not found');
      }

      const group = existingServerConfig.countryGroups.find(
        g => g.name.toLowerCase() === groupName.toLowerCase()
      );

      if (!group) {
        throw new Error(`Country group "${groupName}" not found`);
      }

      // Add countries that don't already exist in the group
      for (const country of countries) {
        const exists = group.countries.some(c => c.countryId === country.countryId);
        if (!exists) {
          group.countries.push(country);
        }
      }

      group.updatedAt = new Date().toISOString();

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Added ${countries.length} countries to group "${groupName}" in server ${serverId}`);
    } catch (error) {
      logger.error('Failed to add countries to group', error);
      throw error;
    }
  }

  /**
   * Remove countries from a group
   */
  static removeCountriesFromGroup(serverId: string, groupName: string, countryIds: string[]): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      if (!existingServerConfig || !existingServerConfig.countryGroups) {
        throw new Error('Country group not found');
      }

      const group = existingServerConfig.countryGroups.find(
        g => g.name.toLowerCase() === groupName.toLowerCase()
      );

      if (!group) {
        throw new Error(`Country group "${groupName}" not found`);
      }

      const originalLength = group.countries.length;
      group.countries = group.countries.filter(c => !countryIds.includes(c.countryId));

      if (group.countries.length < originalLength) {
        group.updatedAt = new Date().toISOString();

        // Update in-memory cache
        this.configCache!.set(serverId, existingServerConfig);

        // Write to disk
        this.writeConfigsToDisk();

        logger.info(`Removed countries from group "${groupName}" in server ${serverId}`);
      }
    } catch (error) {
      logger.error('Failed to remove countries from group', error);
      throw error;
    }
  }
}
