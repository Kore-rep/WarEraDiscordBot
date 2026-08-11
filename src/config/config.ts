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
  minPool?: number; // Minimum total money pool to send a message at all; below this no message is sent (default: none)
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
  minPayout?: number; // Minimum contract payout (total budget) to send a message at all; below this no message is sent (default: none)
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
 * MU directory feature per server. Maintains a curated list of military units
 * rendered as a living, positionally-edited set of directory messages.
 */
export interface MuDirectoryConfig {
  enabled?: boolean;
  channelId: string;
  messageIds: string[];
  manageRoleIds: string[];
  lastUpdated?: string;
}

/**
 * A Discord role granted at (and above) a WarEra level
 */
export interface LevelRoleEntry {
  roleId: string;
  minLevel: number;
}

/**
 * A Discord role removed after a period of WarEra inactivity
 */
export interface TimedRoleEntry {
  roleId: string;
  timeoutDays: number;
}

/**
 * A WarEra military unit in the shared per-server directory. Consumed by the
 * leaderboard, the MU directory, and autorole. `roleId` is the autorole
 * mapping — when unset, autorole displays the MU as "TBD".
 */
export interface MilitaryUnitEntry {
  muId: string;
  muName: string;
  roleId?: string;
}

/**
 * A posted "Link WarEra" button message
 */
export interface LinkMessageEntry {
  channelId: string;
  messageId: string;
}

/**
 * Autorole feature per server: WarEra account linking plus periodic
 * role/nickname sync of linked members.
 */
export interface AutoroleConfig {
  enabled?: boolean; // default true
  checkIntervalSeconds: number; // per-server sync cadence (default 3600, floor 60)
  lastSyncAt?: string; // ISO timestamp of the last completed sync
  levelRoles: LevelRoleEntry[];
  timedRoles: TimedRoleEntry[];
  ecoRoleId?: string;
  warRoleId?: string;
  hybridRoleId?: string;
  ecoThreshold: number; // percent of skill points in eco skills to earn the eco role
  warThreshold: number;
  linkedRoleId?: string; // role given to every member who has linked a WarEra account
  unlinkedRoleId?: string; // role given to members who have not linked a WarEra account
  unlinkedBackfillAt?: string; // ISO timestamp of the one-time backfill sweep (unset = not run yet)
  // OPSEC role: granted once at opsecMinLevel, removed on inactivity during sync,
  // and never auto re-added (see LinkedUser.opsecRevoked). Re-granting is manual.
  opsecRoleId?: string;
  opsecExceptionRoleId?: string; // members holding this role are excluded from automatic OPSEC grants
  opsecMinLevel: number; // WarEra level at which OPSEC is first granted (default 15)
  opsecInactivityDays: number; // days of inactivity before OPSEC is revoked (default 2)
  opsecAutoApply?: boolean; // whether sync auto-grants OPSEC at opsecMinLevel (default true); revocation on inactivity is unaffected
  manageRoleIds: string[]; // roles allowed to act on review approve/deny buttons
  manageUserIds: string[]; // individual users with the same allowance
  proxyRoleIds: string[]; // roles that bypass the country allowlist when linking
  protectedRoleIds: string[]; // never auto-removed by sync
  allowedCountryIds: string[];
  reviewChannelId?: string;
  skipCompanyVerification: boolean;
  linkMessages: LinkMessageEntry[];
  syncNicknames?: boolean; // default true
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
  autorole?: AutoroleConfig;
  militaryUnits?: MilitaryUnitEntry[]; // shared MU directory used by leaderboard, MU directory, and autorole
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
