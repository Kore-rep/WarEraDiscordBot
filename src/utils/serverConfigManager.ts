import {
  ServerConfig,
  BountyBattlesConfig,
  TrackedUser,
  TrackedCountry,
  CountryGroup,
  GroupedCountry,
  SpectreCountryMonitorEntry,
  ProxyUser,
  TrackedProxyCountry,
  LeaderboardConfig,
  MuDirectoryConfig,
  AutoroleConfig,
  MilitaryUnitEntry,
} from '../config/config';
import { logger } from './logger';
import { prisma } from '../persistence/prisma';

function encode(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function decode<T>(value: string | null): T | undefined {
  return value == null ? undefined : (JSON.parse(value) as T);
}

/**
 * Manager for per-server configuration. An in-memory cache is the runtime source
 * of truth; changes are mirrored to SQLite (via Prisma) for durability. Reads are
 * synchronous (from cache); writes update the cache and schedule an async persist.
 */
export class ServerConfigManager {
  private static configCache: Map<string, ServerConfig> | null = null;
  private static persistChain: Promise<void> = Promise.resolve();

  /**
   * Load all server configurations from the database into the in-memory cache.
   * Must be awaited once at startup before any reads.
   */
  static async loadConfigs(): Promise<void> {
    try {
      const rows = await prisma.server.findMany();
      const serversMap = new Map<string, ServerConfig>();

      for (const row of rows) {
        const raw: ServerConfig = {
          bountyBattles: decode(row.bountyBattles),
          mercenaryContracts: decode(row.mercenaryContracts),
          reports: decode(row.reports),
          userTracking: decode(row.userTracking),
          countryTracking: decode(row.countryTracking),
          proxyTracking: decode(row.proxyTracking),
          countryGroups: decode(row.countryGroups),
          spectre: decode(row.spectre),
          leaderboard: decode(row.leaderboard),
          muDirectory: decode(row.muDirectory),
          autorole: decode(row.autorole),
          militaryUnits: decode(row.militaryUnits),
        };
        serversMap.set(row.id, this.normalizeServerConfig(row.id, raw));
      }

      if (serversMap.size === 0) {
        logger.warn('No servers configured in the database. Use /bountybattles config set or /contracts config set to configure servers.');
      }

      this.configCache = serversMap;
      logger.info(`Loaded ${serversMap.size} server configuration(s) into memory`);
    } catch (error) {
      logger.error('Failed to load server configs from database', error);
      throw error;
    }
  }

  /**
   * Validate and normalize a raw server config (defaults, trimming), producing the
   * shape the rest of the app expects. Throws on invalid required fields.
   */
  private static normalizeServerConfig(serverId: string, serverConfig: ServerConfig): ServerConfig {
    if (serverConfig.bountyBattles) {
      if (!serverConfig.bountyBattles.channelId) {
        throw new Error(`Server ${serverId} bountyBattles is missing channelId`);
      }
      if (!Array.isArray(serverConfig.bountyBattles.roleIds)) {
        throw new Error(`Server ${serverId} bountyBattles roleIds must be an array`);
      }
    }

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

    return {
      bountyBattles: serverConfig.bountyBattles ? {
        channelId: serverConfig.bountyBattles.channelId,
        roleIds: serverConfig.bountyBattles.roleIds.filter(id => id && id.trim().length > 0),
        enabled: serverConfig.bountyBattles.enabled,
        bountyThreshold: serverConfig.bountyBattles.bountyThreshold,
        minBountyToSend: serverConfig.bountyBattles.minBountyToSend,
        minPool: serverConfig.bountyBattles.minPool,
      } : undefined,
      mercenaryContracts: serverConfig.mercenaryContracts ? {
        channelId: serverConfig.mercenaryContracts.channelId,
        roleIds: serverConfig.mercenaryContracts.roleIds.filter(id => id && id.trim().length > 0),
        enabled: serverConfig.mercenaryContracts.enabled,
        contractThreshold: serverConfig.mercenaryContracts.contractThreshold,
        minContractToSend: serverConfig.mercenaryContracts.minContractToSend,
        minPayout: serverConfig.mercenaryContracts.minPayout,
      } : undefined,
      reports: serverConfig.reports,
      userTracking: serverConfig.userTracking ? {
        enabled: serverConfig.userTracking.enabled,
        users: serverConfig.userTracking.users || [],
      } : undefined,
      countryTracking: serverConfig.countryTracking ? {
        enabled: serverConfig.countryTracking.enabled,
        countries: serverConfig.countryTracking.countries || [],
      } : undefined,
      proxyTracking: serverConfig.proxyTracking ? {
        enabled: serverConfig.proxyTracking.enabled,
        countries: serverConfig.proxyTracking.countries || [],
        proxies: serverConfig.proxyTracking.proxies || [],
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
      leaderboard: serverConfig.leaderboard ? {
        enabled: serverConfig.leaderboard.enabled,
        channelId: serverConfig.leaderboard.channelId,
        messageId: serverConfig.leaderboard.messageId,
        countryIds: serverConfig.leaderboard.countryIds || [],
        countryNames: serverConfig.leaderboard.countryNames || [],
        topCount: serverConfig.leaderboard.topCount ?? 10,
        levelBrackets: (serverConfig.leaderboard.levelBrackets || []).map(b => ({ ...b })),
        lastSnapshot: serverConfig.leaderboard.lastSnapshot,
        lastUpdated: serverConfig.leaderboard.lastUpdated,
      } : undefined,
      muDirectory: serverConfig.muDirectory ? {
        enabled: serverConfig.muDirectory.enabled,
        channelId: serverConfig.muDirectory.channelId || '',
        messageIds: (serverConfig.muDirectory.messageIds || []).filter(id => id && id.trim().length > 0),
        manageRoleIds: (serverConfig.muDirectory.manageRoleIds || []).filter(id => id && id.trim().length > 0),
        lastUpdated: serverConfig.muDirectory.lastUpdated,
      } : undefined,
      autorole: serverConfig.autorole ? {
        enabled: serverConfig.autorole.enabled,
        checkIntervalSeconds: Math.max(60, serverConfig.autorole.checkIntervalSeconds ?? 3600),
        lastSyncAt: serverConfig.autorole.lastSyncAt,
        levelRoles: (serverConfig.autorole.levelRoles || []).filter(e => e.roleId && e.roleId.trim().length > 0),
        timedRoles: (serverConfig.autorole.timedRoles || []).filter(e => e.roleId && e.roleId.trim().length > 0),
        ecoRoleId: serverConfig.autorole.ecoRoleId,
        warRoleId: serverConfig.autorole.warRoleId,
        hybridRoleId: serverConfig.autorole.hybridRoleId,
        ecoThreshold: serverConfig.autorole.ecoThreshold ?? 60,
        warThreshold: serverConfig.autorole.warThreshold ?? 60,
        linkedRoleId: serverConfig.autorole.linkedRoleId,
        unlinkedRoleId: serverConfig.autorole.unlinkedRoleId,
        unlinkedBackfillAt: serverConfig.autorole.unlinkedBackfillAt,
        opsecRoleId: serverConfig.autorole.opsecRoleId,
        opsecExceptionRoleId: serverConfig.autorole.opsecExceptionRoleId,
        opsecMinLevel: serverConfig.autorole.opsecMinLevel ?? 15,
        opsecInactivityDays: serverConfig.autorole.opsecInactivityDays ?? 2,
        opsecAutoApply: serverConfig.autorole.opsecAutoApply,
        manageRoleIds: (serverConfig.autorole.manageRoleIds || []).filter(id => id && id.trim().length > 0),
        manageUserIds: (serverConfig.autorole.manageUserIds || []).filter(id => id && id.trim().length > 0),
        proxyRoleIds: (serverConfig.autorole.proxyRoleIds || []).filter(id => id && id.trim().length > 0),
        protectedRoleIds: (serverConfig.autorole.protectedRoleIds || []).filter(id => id && id.trim().length > 0),
        allowedCountryIds: (serverConfig.autorole.allowedCountryIds || []).filter(id => id && id.trim().length > 0),
        reviewChannelId: serverConfig.autorole.reviewChannelId,
        skipCompanyVerification: serverConfig.autorole.skipCompanyVerification ?? false,
        welcomeMessage: serverConfig.autorole.welcomeMessage,
        linkMessages: (serverConfig.autorole.linkMessages || []).filter(m => m.channelId?.trim() && m.messageId?.trim()),
        syncNicknames: serverConfig.autorole.syncNicknames,
      } : undefined,
      militaryUnits: serverConfig.militaryUnits
        ? serverConfig.militaryUnits
            .filter(u => u.muId?.trim())
            .map(u => ({
              muId: u.muId.trim(),
              muName: u.muName?.trim() || `MU ${u.muId.trim()}`,
              ...(u.roleId?.trim() ? { roleId: u.roleId.trim() } : {}),
            }))
        : undefined,
    };
  }

  /**
   * Read all server configurations from memory cache
   * If cache is not initialized, loads it first
   */
  static readServerConfigs(): Map<string, ServerConfig> {
    this.ensureCacheInitialized();
    
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
      this.ensureCacheInitialized();
      
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
        minPool: config.minPool !== undefined ? config.minPool : existingBountyConfig.minPool,
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
      this.ensureCacheInitialized();
      
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
        minPayout: config.minPayout !== undefined ? config.minPayout : existingMercenaryConfig.minPayout,
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
   * Ensure the in-memory cache exists. `loadConfigs()` should be awaited at startup;
   * this is a safety net for any read/write that races ahead of it.
   */
  private static ensureCacheInitialized(): void {
    if (this.configCache === null) {
      logger.warn('Config cache not initialized; using an empty cache. Ensure loadConfigs() is awaited at startup.');
      this.configCache = new Map();
    }
  }

  /**
   * Schedule an asynchronous persist of the in-memory cache to the database. Kept
   * synchronous (fire-and-forget) so the many mutator callers stay unchanged; writes
   * are serialized and errors logged. Call flush() to await pending writes.
   */
  private static writeConfigsToDisk(): void {
    if (this.configCache === null) {
      return;
    }
    this.persistChain = this.persistChain
      .then(() => this.persistAll())
      .catch(error => logger.error('Failed to persist server configs to database', error));
  }

  /** Await any pending database writes (call on shutdown to avoid losing the last write). */
  static async flush(): Promise<void> {
    await this.persistChain;
  }

  /** Sync the entire Server table to the current in-memory cache in one transaction. */
  private static async persistAll(): Promise<void> {
    if (this.configCache === null) {
      return;
    }
    const entries = Array.from(this.configCache.entries());
    const ids = entries.map(([id]) => id);
    await prisma.$transaction([
      prisma.server.deleteMany({ where: ids.length > 0 ? { id: { notIn: ids } } : {} }),
      ...entries.map(([id, cfg]) => {
        const data = {
          bountyBattles: encode(cfg.bountyBattles),
          mercenaryContracts: encode(cfg.mercenaryContracts),
          reports: encode(cfg.reports),
          userTracking: encode(cfg.userTracking),
          countryTracking: encode(cfg.countryTracking),
          proxyTracking: encode(cfg.proxyTracking),
          countryGroups: encode(cfg.countryGroups),
          spectre: encode(cfg.spectre),
          leaderboard: encode(cfg.leaderboard),
          muDirectory: encode(cfg.muDirectory),
          autorole: encode(cfg.autorole),
          militaryUnits: encode(cfg.militaryUnits),
        };
        return prisma.server.upsert({ where: { id }, create: { id, ...data }, update: data });
      }),
    ]);
  }

  /**
   * Get configuration for a specific server from memory cache
   */
  static getServerConfig(serverId: string): ServerConfig | undefined {
    this.ensureCacheInitialized();
    
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
      countryTracking: config.countryTracking ? {
        ...config.countryTracking,
        countries: config.countryTracking.countries.map(c => ({ ...c })),
      } : undefined,
      proxyTracking: config.proxyTracking ? {
        ...config.proxyTracking,
        countries: config.proxyTracking.countries.map(c => ({ ...c })),
        proxies: config.proxyTracking.proxies.map(p => ({ ...p })),
      } : undefined,
      countryGroups: config.countryGroups ? config.countryGroups.map(g => ({
        ...g,
        countries: g.countries.map(c => ({ ...c })),
      })) : [],
      spectre: config.spectre ? {
        buildingMonitors: (config.spectre.buildingMonitors || []).map(m => ({ ...m })),
        resistanceMonitors: (config.spectre.resistanceMonitors || []).map(m => ({ ...m })),
      } : undefined,
      leaderboard: config.leaderboard ? {
        ...config.leaderboard,
        countryIds: [...config.leaderboard.countryIds],
        countryNames: [...config.leaderboard.countryNames],
        levelBrackets: config.leaderboard.levelBrackets.map(b => ({ ...b })),
        lastSnapshot: config.leaderboard.lastSnapshot ? {
          ...config.leaderboard.lastSnapshot,
          playerTotal: config.leaderboard.lastSnapshot.playerTotal.map(e => ({ ...e })),
          playerWeeklyByBracket: Object.fromEntries(
            Object.entries(config.leaderboard.lastSnapshot.playerWeeklyByBracket).map(
              ([key, entries]) => [key, entries.map(e => ({ ...e }))]
            )
          ),
          muTotal: config.leaderboard.lastSnapshot.muTotal.map(e => ({ ...e })),
          muWeekly: config.leaderboard.lastSnapshot.muWeekly.map(e => ({ ...e })),
        } : undefined,
      } : undefined,
      muDirectory: config.muDirectory ? {
        ...config.muDirectory,
        messageIds: [...config.muDirectory.messageIds],
        manageRoleIds: [...config.muDirectory.manageRoleIds],
      } : undefined,
      autorole: config.autorole ? {
        ...config.autorole,
        levelRoles: config.autorole.levelRoles.map(e => ({ ...e })),
        timedRoles: config.autorole.timedRoles.map(e => ({ ...e })),
        manageRoleIds: [...config.autorole.manageRoleIds],
        manageUserIds: [...config.autorole.manageUserIds],
        proxyRoleIds: [...config.autorole.proxyRoleIds],
        protectedRoleIds: [...config.autorole.protectedRoleIds],
        allowedCountryIds: [...config.autorole.allowedCountryIds],
        linkMessages: config.autorole.linkMessages.map(m => ({ ...m })),
      } : undefined,
      militaryUnits: config.militaryUnits ? config.militaryUnits.map(u => ({ ...u })) : undefined,
    };
  }

  /**
   * Add or update a Spectre border building monitor for a server
   */
  static upsertSpectreBuildingMonitor(serverId: string, entry: SpectreCountryMonitorEntry): void {
    try {
      this.ensureCacheInitialized();

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
      this.ensureCacheInitialized();

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
      this.ensureCacheInitialized();

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
   * Reload configurations from the database into memory cache.
   * Useful for external changes or testing.
   */
  static async reloadConfigs(): Promise<void> {
    logger.info('Reloading server configurations from database');
    await this.loadConfigs();
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
   * Add a country to track for a specific server
   */
  static addTrackedCountry(serverId: string, country: TrackedCountry): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingCountryTracking = existingServerConfig.countryTracking || {
        enabled: true,
        countries: [],
      };

      // Check if country is already being tracked
      const existingCountryIndex = existingCountryTracking.countries.findIndex(c => c.countryId === country.countryId);
      
      if (existingCountryIndex !== -1) {
        // Update existing country
        existingCountryTracking.countries[existingCountryIndex] = country;
      } else {
        // Add new country
        existingCountryTracking.countries.push(country);
      }

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        countryTracking: existingCountryTracking,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Added/updated tracked country ${country.countryId} for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to add tracked country', error);
      throw error;
    }
  }

  /**
   * Remove a tracked country from a specific server
   */
  static removeTrackedCountry(serverId: string, countryId: string): boolean {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.countryTracking) {
        logger.warn(`No country tracking config found for server ${serverId}`);
        return false;
      }

      const initialLength = existingServerConfig.countryTracking.countries.length;
      existingServerConfig.countryTracking.countries = existingServerConfig.countryTracking.countries.filter(
        c => c.countryId !== countryId
      );

      if (existingServerConfig.countryTracking.countries.length === initialLength) {
        logger.warn(`Country ${countryId} not found in tracking for server ${serverId}`);
        return false;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Removed tracked country ${countryId} from server ${serverId}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove tracked country', error);
      throw error;
    }
  }

  /**
   * Update tracking status for a country (lastChecked, lastPopulation, warnReported)
   */
  static updateTrackedCountryStatus(
    serverId: string, 
    countryId: string, 
    lastChecked: string, 
    lastPopulation?: number,
    warnReported?: boolean
  ): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.countryTracking) {
        logger.warn(`No country tracking config found for server ${serverId}`);
        return;
      }

      const country = existingServerConfig.countryTracking.countries.find(c => c.countryId === countryId);
      
      if (!country) {
        logger.warn(`Country ${countryId} not found in tracking for server ${serverId}`);
        return;
      }

      country.lastChecked = lastChecked;
      if (lastPopulation !== undefined) {
        country.lastPopulation = lastPopulation;
      }
      if (warnReported !== undefined) {
        country.warnReported = warnReported;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.debug(`Updated tracking status for country ${countryId} in server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update tracked country status', error);
      throw error;
    }
  }

  /**
   * Get all tracked countries for a specific server
   */
  static getTrackedCountries(serverId: string): TrackedCountry[] {
    const config = this.getServerConfig(serverId);
    return config?.countryTracking?.countries || [];
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

  /**
   * Add a proxy country to track for a specific server
   */
  static addTrackedProxyCountry(serverId: string, country: TrackedProxyCountry): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingProxyTracking = existingServerConfig.proxyTracking || {
        enabled: true,
        countries: [],
        proxies: [],
      };

      // Check if country is already being tracked
      const existingCountryIndex = existingProxyTracking.countries.findIndex(c => c.countryId === country.countryId);
      
      if (existingCountryIndex !== -1) {
        // Update existing country
        existingProxyTracking.countries[existingCountryIndex] = country;
      } else {
        // Add new country
        existingProxyTracking.countries.push(country);
      }

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        proxyTracking: existingProxyTracking,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Added/updated tracked proxy country ${country.countryId} for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to add tracked proxy country', error);
      throw error;
    }
  }

  /**
   * Remove a tracked proxy country from a specific server
   */
  static removeTrackedProxyCountry(serverId: string, countryId: string): boolean {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.proxyTracking) {
        logger.warn(`No proxy tracking config found for server ${serverId}`);
        return false;
      }

      const initialLength = existingServerConfig.proxyTracking.countries.length;
      existingServerConfig.proxyTracking.countries = existingServerConfig.proxyTracking.countries.filter(
        c => c.countryId !== countryId
      );

      if (existingServerConfig.proxyTracking.countries.length === initialLength) {
        logger.warn(`Proxy country ${countryId} not found in tracking for server ${serverId}`);
        return false;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Removed tracked proxy country ${countryId} from server ${serverId}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove tracked proxy country', error);
      throw error;
    }
  }

  /**
   * Update tracking status for a proxy country (lastChecked, initialUsers)
   */
  static updateTrackedProxyCountry(
    serverId: string, 
    countryId: string, 
    lastChecked: string, 
    initialUsers?: string[]
  ): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.proxyTracking) {
        logger.warn(`No proxy tracking config found for server ${serverId}`);
        return;
      }

      const country = existingServerConfig.proxyTracking.countries.find(c => c.countryId === countryId);
      
      if (!country) {
        logger.warn(`Proxy country ${countryId} not found in tracking for server ${serverId}`);
        return;
      }

      country.lastChecked = lastChecked;
      if (initialUsers !== undefined) {
        country.initialUsers = initialUsers;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.debug(`Updated tracking status for proxy country ${countryId} in server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update tracked proxy country status', error);
      throw error;
    }
  }

  /**
   * Add a proxy user for a specific server
   */
  static addProxyUser(serverId: string, proxyUser: ProxyUser): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingProxyTracking = existingServerConfig.proxyTracking || {
        enabled: true,
        countries: [],
        proxies: [],
      };

      // Check if proxy user is already tracked
      const existingProxyIndex = existingProxyTracking.proxies.findIndex(p => p.userId === proxyUser.userId);
      
      if (existingProxyIndex !== -1) {
        // Update existing proxy
        existingProxyTracking.proxies[existingProxyIndex] = proxyUser;
      } else {
        // Add new proxy
        existingProxyTracking.proxies.push(proxyUser);
      }

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        proxyTracking: existingProxyTracking,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Added/updated proxy user ${proxyUser.userId} for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to add proxy user', error);
      throw error;
    }
  }

  /**
   * Remove a proxy user from a specific server
   */
  static removeProxyUser(serverId: string, userId: string): boolean {
    try {
      const existingServerConfig = this.configCache!.get(serverId);
      
      if (!existingServerConfig?.proxyTracking) {
        logger.warn(`No proxy tracking config found for server ${serverId}`);
        return false;
      }

      const initialLength = existingServerConfig.proxyTracking.proxies.length;
      existingServerConfig.proxyTracking.proxies = existingServerConfig.proxyTracking.proxies.filter(
        p => p.userId !== userId
      );

      if (existingServerConfig.proxyTracking.proxies.length === initialLength) {
        logger.warn(`Proxy user ${userId} not found in tracking for server ${serverId}`);
        return false;
      }

      // Update in-memory cache
      this.configCache!.set(serverId, existingServerConfig);

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Removed proxy user ${userId} from server ${serverId}`);
      return true;
    } catch (error) {
      logger.error('Failed to remove proxy user', error);
      throw error;
    }
  }

  /**
   * Get all tracked proxy countries for a specific server
   */
  static getTrackedProxyCountries(serverId: string): TrackedProxyCountry[] {
    const config = this.getServerConfig(serverId);
    return config?.proxyTracking?.countries || [];
  }

  /**
   * Get all proxy users for a specific server
   */
  static getProxyUsers(serverId: string): ProxyUser[] {
    const config = this.getServerConfig(serverId);
    return config?.proxyTracking?.proxies || [];
  }

  /**
   * Update proxy tracking enabled status for a server
   */
  static updateProxyTrackingStatus(serverId: string, enabled: boolean): void {
    try {
      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingProxyTracking = existingServerConfig.proxyTracking || {
        enabled: true,
        countries: [],
        proxies: [],
      };

      existingProxyTracking.enabled = enabled;

      // Update in-memory cache
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        proxyTracking: existingProxyTracking,
      });

      // Write to disk
      this.writeConfigsToDisk();

      logger.info(`Updated proxy tracking status to ${enabled} for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update proxy tracking status', error);
      throw error;
    }
  }

  /**
   * Update leaderboard configuration for a server
   */
  static updateLeaderboardConfig(serverId: string, config: Partial<LeaderboardConfig>): void {
    try {
      this.ensureCacheInitialized();

      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existingLeaderboard = existingServerConfig.leaderboard || {
        channelId: '',
        countryIds: [],
        countryNames: [],
        topCount: 10,
        levelBrackets: [],
        enabled: true,
      };

      const updatedLeaderboard: LeaderboardConfig = {
        channelId: config.channelId !== undefined ? config.channelId : existingLeaderboard.channelId,
        countryIds: config.countryIds !== undefined ? config.countryIds : existingLeaderboard.countryIds,
        countryNames: config.countryNames !== undefined ? config.countryNames : existingLeaderboard.countryNames,
        topCount: config.topCount !== undefined ? config.topCount : existingLeaderboard.topCount,
        levelBrackets: config.levelBrackets !== undefined ? config.levelBrackets : existingLeaderboard.levelBrackets,
        enabled: config.enabled !== undefined ? config.enabled : existingLeaderboard.enabled,
        messageId: config.messageId !== undefined ? config.messageId : existingLeaderboard.messageId,
        lastSnapshot: config.lastSnapshot !== undefined ? config.lastSnapshot : existingLeaderboard.lastSnapshot,
        lastUpdated: config.lastUpdated !== undefined ? config.lastUpdated : existingLeaderboard.lastUpdated,
      };

      this.configCache!.set(serverId, {
        ...existingServerConfig,
        leaderboard: updatedLeaderboard,
      });

      this.writeConfigsToDisk();
      logger.info(`Updated leaderboard config for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update leaderboard config', error);
      throw error;
    }
  }

  /** Read a server's MU directory config (deep copy), or undefined if unset. */
  static getMuDirectoryConfig(serverId: string): MuDirectoryConfig | undefined {
    return this.getServerConfig(serverId)?.muDirectory;
  }

  private static defaultMuDirectory(): MuDirectoryConfig {
    return {
      enabled: true,
      channelId: '',
      messageIds: [],
      manageRoleIds: [],
    };
  }

  /**
   * Update MU directory configuration for a server, merging over the existing
   * block (or a default one if none exists yet).
   */
  static updateMuDirectoryConfig(serverId: string, config: Partial<MuDirectoryConfig>): void {
    try {
      this.ensureCacheInitialized();

      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existing = existingServerConfig.muDirectory || this.defaultMuDirectory();

      const updated: MuDirectoryConfig = {
        enabled: config.enabled !== undefined ? config.enabled : existing.enabled,
        channelId: config.channelId !== undefined ? config.channelId : existing.channelId,
        messageIds: config.messageIds !== undefined ? config.messageIds : existing.messageIds,
        manageRoleIds: config.manageRoleIds !== undefined ? config.manageRoleIds : existing.manageRoleIds,
        lastUpdated: config.lastUpdated !== undefined ? config.lastUpdated : existing.lastUpdated,
      };

      this.configCache!.set(serverId, {
        ...existingServerConfig,
        muDirectory: updated,
      });

      this.writeConfigsToDisk();
      logger.info(`Updated MU directory config for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update MU directory config', error);
      throw error;
    }
  }

  /** Read a server's autorole config (deep copy), or undefined if unset. */
  static getAutoroleConfig(serverId: string): AutoroleConfig | undefined {
    return this.getServerConfig(serverId)?.autorole;
  }

  private static defaultAutorole(): AutoroleConfig {
    return {
      enabled: true,
      checkIntervalSeconds: 3600,
      levelRoles: [],
      timedRoles: [],
      ecoThreshold: 60,
      warThreshold: 60,
      opsecMinLevel: 15,
      opsecInactivityDays: 2,
      manageRoleIds: [],
      manageUserIds: [],
      proxyRoleIds: [],
      protectedRoleIds: [],
      allowedCountryIds: [],
      skipCompanyVerification: false,
      linkMessages: [],
    };
  }

  /**
   * Update autorole configuration for a server, merging over the existing
   * block (or a default one if none exists yet).
   */
  static updateAutoroleConfig(serverId: string, config: Partial<AutoroleConfig>): void {
    try {
      this.ensureCacheInitialized();

      const existingServerConfig = this.configCache!.get(serverId) || {};
      const existing = existingServerConfig.autorole || this.defaultAutorole();

      const updated: AutoroleConfig = {
        enabled: config.enabled !== undefined ? config.enabled : existing.enabled,
        checkIntervalSeconds: Math.max(60, config.checkIntervalSeconds !== undefined ? config.checkIntervalSeconds : existing.checkIntervalSeconds),
        lastSyncAt: config.lastSyncAt !== undefined ? config.lastSyncAt : existing.lastSyncAt,
        levelRoles: config.levelRoles !== undefined ? config.levelRoles : existing.levelRoles,
        timedRoles: config.timedRoles !== undefined ? config.timedRoles : existing.timedRoles,
        ecoRoleId: config.ecoRoleId !== undefined ? config.ecoRoleId : existing.ecoRoleId,
        warRoleId: config.warRoleId !== undefined ? config.warRoleId : existing.warRoleId,
        hybridRoleId: config.hybridRoleId !== undefined ? config.hybridRoleId : existing.hybridRoleId,
        ecoThreshold: config.ecoThreshold !== undefined ? config.ecoThreshold : existing.ecoThreshold,
        warThreshold: config.warThreshold !== undefined ? config.warThreshold : existing.warThreshold,
        linkedRoleId: config.linkedRoleId !== undefined ? config.linkedRoleId : existing.linkedRoleId,
        unlinkedRoleId: config.unlinkedRoleId !== undefined ? config.unlinkedRoleId : existing.unlinkedRoleId,
        unlinkedBackfillAt: config.unlinkedBackfillAt !== undefined ? config.unlinkedBackfillAt : existing.unlinkedBackfillAt,
        opsecRoleId: config.opsecRoleId !== undefined ? config.opsecRoleId : existing.opsecRoleId,
        opsecExceptionRoleId: config.opsecExceptionRoleId !== undefined ? config.opsecExceptionRoleId : existing.opsecExceptionRoleId,
        opsecMinLevel: config.opsecMinLevel !== undefined ? config.opsecMinLevel : (existing.opsecMinLevel ?? 15),
        opsecInactivityDays: config.opsecInactivityDays !== undefined ? config.opsecInactivityDays : (existing.opsecInactivityDays ?? 2),
        opsecAutoApply: config.opsecAutoApply !== undefined ? config.opsecAutoApply : existing.opsecAutoApply,
        manageRoleIds: config.manageRoleIds !== undefined ? config.manageRoleIds : existing.manageRoleIds,
        manageUserIds: config.manageUserIds !== undefined ? config.manageUserIds : existing.manageUserIds,
        proxyRoleIds: config.proxyRoleIds !== undefined ? config.proxyRoleIds : existing.proxyRoleIds,
        protectedRoleIds: config.protectedRoleIds !== undefined ? config.protectedRoleIds : existing.protectedRoleIds,
        allowedCountryIds: config.allowedCountryIds !== undefined ? config.allowedCountryIds : existing.allowedCountryIds,
        reviewChannelId: config.reviewChannelId !== undefined ? config.reviewChannelId : existing.reviewChannelId,
        skipCompanyVerification: config.skipCompanyVerification !== undefined ? config.skipCompanyVerification : existing.skipCompanyVerification,
        welcomeMessage: config.welcomeMessage !== undefined ? config.welcomeMessage : existing.welcomeMessage,
        linkMessages: config.linkMessages !== undefined ? config.linkMessages : existing.linkMessages,
        syncNicknames: config.syncNicknames !== undefined ? config.syncNicknames : existing.syncNicknames,
      };

      this.configCache!.set(serverId, {
        ...existingServerConfig,
        autorole: updated,
      });

      this.writeConfigsToDisk();
      logger.info(`Updated autorole config for server ${serverId}`);
    } catch (error) {
      logger.error('Failed to update autorole config', error);
      throw error;
    }
  }

  /**
   * Read a server's shared military-unit list (deep copy). This is the single
   * source of MUs consumed by the leaderboard, the MU directory, and autorole.
   */
  static getMilitaryUnits(serverId: string): MilitaryUnitEntry[] {
    return this.getServerConfig(serverId)?.militaryUnits ?? [];
  }

  /** Replace a server's shared military-unit list. */
  static updateMilitaryUnits(serverId: string, units: MilitaryUnitEntry[]): void {
    try {
      this.ensureCacheInitialized();

      const existingServerConfig = this.configCache!.get(serverId) || {};
      this.configCache!.set(serverId, {
        ...existingServerConfig,
        militaryUnits: units.map(u => ({ ...u })),
      });

      this.writeConfigsToDisk();
      logger.info(`Updated military units for server ${serverId} (${units.length} MUs)`);
    } catch (error) {
      logger.error('Failed to update military units', error);
      throw error;
    }
  }
}
