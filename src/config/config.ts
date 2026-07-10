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
 * A proxy user that has moved from their original country
 */
export interface ProxyUser {
  userId: string;
  username: string; // War Era username
  originalCountryId: string; // Country they left
  originalCountryName: string;
  proxyCountryId: string; // Country they moved to
  proxyCountryName: string;
  detectedAt: string; // ISO timestamp when movement detected
  lastCitizenshipChangeAt: string; // From API for cooldown calculation
  manuallyAdded?: boolean; // True if added via command, not auto-detected
}

/**
 * A single tracked country configuration for proxy monitoring
 */
export interface TrackedProxyCountry {
  countryId: string;
  countryName: string;
  channelId: string; // Where to report proxy movements
  enabled: boolean;
  initialUsers?: string[]; // User IDs present when tracking started
  lastChecked?: string;
  mentionIds?: string[]; // Discord mentions for notifications
}

/**
 * Configuration for proxy tracking feature per server
 */
export interface ProxyTrackingConfig {
  enabled?: boolean;
  countries: TrackedProxyCountry[];
  proxies: ProxyUser[]; // All detected/added proxies across countries
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
 * Level bracket for weekly player damage leaderboards
 */
export interface LevelBracket {
  minLevel: number;
  maxLevel?: number; // omit = no upper bound (40+)
  label: string;
}

/**
 * A single ranked entry in a leaderboard snapshot
 */
export interface LeaderboardRankEntry {
  id: string;
  name: string;
  value: number;
  countryCode?: string;
  level?: number;
}

/**
 * Stored leaderboard ranks from the previous refresh (for movement arrows)
 */
export interface LeaderboardSnapshot {
  playerTotal: LeaderboardRankEntry[];
  playerWeeklyByBracket: Record<string, LeaderboardRankEntry[]>;
  muTotal: LeaderboardRankEntry[];
  muWeekly: LeaderboardRankEntry[];
  capturedAt: string;
}

/**
 * Hourly leaderboard feature per server
 */
export interface LeaderboardConfig {
  enabled?: boolean;
  channelId: string;
  messageId?: string;
  countryIds: string[];
  countryNames: string[];
  militaryUnitIds: string[];
  topCount: number;
  levelBrackets: LevelBracket[];
  lastSnapshot?: LeaderboardSnapshot;
  lastUpdated?: string;
}

export const DEFAULT_LEVEL_BRACKETS: LevelBracket[] = [
  { minLevel: 20, maxLevel: 29, label: '20-29' },
  { minLevel: 30, maxLevel: 39, label: '30-39' },
  { minLevel: 40, label: '40+' },
];

/**
 * A single military unit tracked by the MU directory. Name/url are kept so a
 * stale entry can still render if the API fetch for it fails on a refresh.
 */
export interface MuDirectoryUnit {
  id: string;
  name: string;
  url: string;
}

/**
 * MU directory feature per server. Maintains a curated list of military units
 * rendered as a living, positionally-edited set of directory messages.
 */
export interface MuDirectoryConfig {
  enabled?: boolean;
  channelId: string;
  messageIds: string[];
  units: MuDirectoryUnit[];
  manageRoleIds: string[];
  lastUpdated?: string;
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
  proxyTracking?: ProxyTrackingConfig;
  countryGroups?: CountryGroup[];
  spectre?: SpectreConfig;
  leaderboard?: LeaderboardConfig;
  muDirectory?: MuDirectoryConfig;
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
 * Validates and loads configuration from environment variables and the database.
 * Throws an error if required variables are missing.
 */
export async function loadConfig(): Promise<BotConfig> {
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

  // Initialize ServerConfigManager cache from the database - the single source of truth
  await ServerConfigManager.loadConfigs();

  // Load server configurations from the now-initialized cache
  const servers = ServerConfigManager.readServerConfigs();

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

