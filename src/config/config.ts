import dotenv from 'dotenv';
import { ServerConfigManager } from '../utils/serverConfigManager';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration for bounty battles feature per server
 */
export interface BountyBattlesConfig {
  channelId: string;
  roleIds: string[];
  enabled?: boolean; // Whether bounty battle notifications are enabled (default: true)
  bountyThreshold?: number; // Minimum total bounty (attacker + defender) to trigger role mentions (default: 0)
  minBountyToSend?: number; // Minimum total bounty to send a message at all; below this no message is sent (default: none)
}

/**
 * Configuration for mercenary contract auctions feature per server
 */
export interface MercenaryContractsConfig {
  channelId: string;
  roleIds: string[];
  enabled?: boolean; // Whether mercenary contract notifications are enabled (default: true)
  contractThreshold?: number; // Minimum gold per 1k damage to trigger role mentions (default: 0)
  minContractToSend?: number; // Minimum gold per 1k damage to send a message at all; below this no message is sent (default: none)
}

/**
 * Configuration for reports feature per server
 */
export interface ReportsConfig {
  channelId?: string;
  enabled?: boolean;
  schedule?: string; // Cron schedule or interval
}

/**
 * A single tracked user configuration
 */
export interface TrackedUser {
  userId: string;
  username: string; // War Era username
  channelId: string;
  inactivityDays: number; // Number of days of inactivity before notification (default: 2)
  mentionIds?: string[]; // Full Discord mention strings to include in notifications (e.g., ['<@123>', '<@&456>'])
  reported?: boolean; // Whether inactivity has been reported (reset when user becomes active)
  lastChecked?: string; // ISO timestamp of last check
  lastActive?: string; // ISO timestamp of user's last activity from API
}

/**
 * Configuration for user tracking feature per server
 */
export interface UserTrackingConfig {
  enabled?: boolean;
  users: TrackedUser[];
}

/**
 * A single tracked country configuration
 */
export interface TrackedCountry {
  countryId: string;
  countryName: string; // War Era country name
  channelId: string;
  populationWarnThreshold: number; // Population threshold for one-time warning
  populationCriticalThreshold: number; // Population threshold for repeated alerts
  mentionIds?: string[]; // Full Discord mention strings to include in notifications
  warnReported?: boolean; // Whether warn threshold breach has been reported (reset when population increases)
  lastChecked?: string; // ISO timestamp of last check
  lastPopulation?: number; // Last known population count
}

/**
 * Configuration for country tracking feature per server
 */
export interface CountryTrackingConfig {
  enabled?: boolean;
  countries: TrackedCountry[];
}

/**
 * A country in a country group
 */
export interface GroupedCountry {
  countryId: string;
  countryName: string;
}

/**
 * A named group of countries
 */
export interface CountryGroup {
  id: string; // Unique identifier for the group
  name: string; // User-friendly name
  countries: GroupedCountry[]; // Array of countries in this group
  createdBy: string; // Discord user ID who created it
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/**
 * One monitored country for /spectre (buildings or resistance)
 */
export interface SpectreCountryMonitorEntry {
  countryId: string;
  countryName: string;
  channelId: string;
  enabled: boolean;
}

/**
 * Spectre (military monitoring) feature per server
 */
export interface SpectreConfig {
  buildingMonitors: SpectreCountryMonitorEntry[];
  resistanceMonitors: SpectreCountryMonitorEntry[];
}

/**
 * Configuration for a single Discord server
 * Contains feature-specific configurations
 */
export interface ServerConfig {
  bountyBattles?: BountyBattlesConfig;
  mercenaryContracts?: MercenaryContractsConfig;
  reports?: ReportsConfig;
  userTracking?: UserTrackingConfig;
  countryTracking?: CountryTrackingConfig;
  countryGroups?: CountryGroup[];
  spectre?: SpectreConfig;
}

/**
 * Configuration interface for the bot
 */
export interface BotConfig {
  discord: {
    token: string;
    servers: Map<string, ServerConfig>; // serverId -> ServerConfig
  };
  api: {
    baseUrl?: string;
    apiKey?: string;
    // Add other API config options as needed
  };
  polling: {
    intervalMinutes: number;
  };
}

/**
 * Loads server configurations from ServerConfigManager
 * ServerConfigManager must be initialized first via loadConfigs()
 */
function loadServerConfigs(): Map<string, ServerConfig> {
  // ServerConfigManager has already been initialized with loadConfigs() at this point
  // Just retrieve the configs from memory
  return ServerConfigManager.readServerConfigs();
}

/**
 * Validates and loads configuration from environment variables and serverConfig.json
 * Throws an error if required variables are missing
 */
export function loadConfig(): BotConfig {
  const discordToken = process.env.DISCORD_TOKEN;
  const intervalMinutes = process.env.POLLING_INTERVAL_MINUTES;

  if (!discordToken) {
    throw new Error('DISCORD_TOKEN environment variable is required');
  }

  if (!intervalMinutes) {
    throw new Error('POLLING_INTERVAL_MINUTES environment variable is required');
  }

  const interval = parseInt(intervalMinutes, 10);
  if (isNaN(interval) || interval <= 0) {
    throw new Error('POLLING_INTERVAL_MINUTES must be a positive number');
  }

  // Initialize ServerConfigManager cache - this is the single source of truth for server configs
  ServerConfigManager.loadConfigs();

  // Load server configurations from ServerConfigManager
  const servers = loadServerConfigs();

  return {
    discord: {
      token: discordToken,
      servers: servers,
    },
    api: {
      baseUrl: process.env.API_BASE_URL,
      apiKey: process.env.WARERA_API_KEY,
    },
    polling: {
      intervalMinutes: interval,
    },
  };
}

