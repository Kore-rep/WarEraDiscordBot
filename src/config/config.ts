import dotenv from 'dotenv';
import { ServerConfigManager } from '../utils/serverConfigManager';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration for a single Discord server
 */
export interface ServerConfig {
  channelId: string;
  roleIds: string[];
  enabled?: boolean; // Whether bounty battle notifications are enabled (default: true)
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
 * Validates and loads configuration from environment variables and servers.json
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
    },
    polling: {
      intervalMinutes: interval,
    },
  };
}

