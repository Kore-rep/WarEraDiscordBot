import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config();

/**
 * Configuration for a single Discord server
 */
export interface ServerConfig {
  channelId: string;
  roleIds: string[];
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
 * Loads server configurations from servers.json file
 * Throws an error if the file is missing or invalid
 */
function loadServerConfigs(): Map<string, ServerConfig> {
  const serversFilePath = path.join(process.cwd(), 'servers.json');
  
  if (!fs.existsSync(serversFilePath)) {
    throw new Error(
      `servers.json file not found at ${serversFilePath}. ` +
      `Please create it based on servers.json.example`
    );
  }

  try {
    const fileContent = fs.readFileSync(serversFilePath, 'utf-8');
    const config = JSON.parse(fileContent) as { servers: Record<string, ServerConfig> };

    if (!config.servers || typeof config.servers !== 'object') {
      throw new Error('servers.json must contain a "servers" object');
    }

    const serversMap = new Map<string, ServerConfig>();

    for (const [serverId, serverConfig] of Object.entries(config.servers)) {
      if (!serverConfig.channelId) {
        throw new Error(`Server ${serverId} is missing channelId`);
      }

      if (!Array.isArray(serverConfig.roleIds)) {
        throw new Error(`Server ${serverId} roleIds must be an array`);
      }

      serversMap.set(serverId, {
        channelId: serverConfig.channelId,
        roleIds: serverConfig.roleIds.filter(id => id && id.trim().length > 0),
      });
    }

    if (serversMap.size === 0) {
      throw new Error('No servers configured in servers.json');
    }

    return serversMap;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in servers.json: ${error.message}`);
    }
    throw error;
  }
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

  // Load server configurations from JSON file
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

