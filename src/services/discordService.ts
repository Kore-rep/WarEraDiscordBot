import { Client, TextChannel, User } from 'discord.js';
import { logger } from '../utils/logger';
import { BotConfig } from '../config';

/**
 * Service for handling Discord-related operations
 */
export class DiscordService {
  private client: Client;
  private config: BotConfig;
  private channels: Map<string, TextChannel> = new Map(); // serverId -> channel

  constructor(client: Client, config: BotConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Initialize the Discord service by fetching all configured channels
   */
  async initialize(): Promise<void> {
    try {
      const serverConfigs = Array.from(this.config.discord.servers.entries());
      
      if (serverConfigs.length === 0) {
        throw new Error('No servers configured');
      }

      logger.info(`Initializing Discord service for ${serverConfigs.length} server(s)...`);

      for (const [serverId, serverConfig] of serverConfigs) {
        try {
          const channel = await this.client.channels.fetch(serverConfig.channelId);
          
          if (!channel) {
            logger.warn(`Channel with ID ${serverConfig.channelId} not found for server ${serverId}`);
            continue;
          }

          if (!channel.isTextBased()) {
            logger.warn(`Channel with ID ${serverConfig.channelId} is not a text channel for server ${serverId}`);
            continue;
          }

          this.channels.set(serverId, channel as TextChannel);
          logger.info(`Initialized channel for server ${serverId}: ${(channel as TextChannel).name}`);
        } catch (error) {
          logger.error(`Failed to initialize channel for server ${serverId}`, error);
          // Continue with other servers even if one fails
        }
      }

      if (this.channels.size === 0) {
        throw new Error('Failed to initialize any channels. Check your servers.json configuration.');
      }

      logger.info(`Discord service initialized. Connected to ${this.channels.size} channel(s)`);
    } catch (error) {
      logger.error('Failed to initialize Discord service', error);
      throw error;
    }
  }

  /**
   * Send a message to a specific server's channel, mentioning specific roles
   * 
   * @param serverId - Discord server ID
   * @param roleIds - Array of role IDs to mention
   * @param message - Optional custom message (defaults to mentioning roles)
   */
  async sendMentionMessage(serverId: string, roleIds: string[], message?: string): Promise<void> {
    const channel = this.channels.get(serverId);
    
    if (!channel) {
      throw new Error(`Channel not initialized for server ${serverId}. Call initialize() first.`);
    }

    if (roleIds.length === 0) {
      logger.debug(`No roles to mention for server ${serverId}`);
      return;
    }

    try {
      // Build mention string for roles (format: <@&roleId>)
      const mentions = roleIds
        .map(roleId => `<@&${roleId}>`)
        .join(' ');

      // Default message if none provided
      const finalMessage = message || `${mentions}`;

      // Send the message
      await channel.send(finalMessage);
      
      logger.info(`Sent mention message to ${roleIds.length} role(s) in server ${serverId} (channel: ${channel.name})`);
    } catch (error) {
      logger.error(`Failed to send mention message to server ${serverId}`, error);
      throw error;
    }
  }

  /**
   * Send a general message to a specific server's channel (without mentions)
   * 
   * @param serverId - Discord server ID
   * @param message - Message content to send
   */
  async sendMessage(serverId: string, message: string): Promise<void> {
    const channel = this.channels.get(serverId);
    
    if (!channel) {
      throw new Error(`Channel not initialized for server ${serverId}. Call initialize() first.`);
    }

    try {
      await channel.send(message);
      logger.debug(`Sent message to server ${serverId} (channel: ${channel.name})`);
    } catch (error) {
      logger.error(`Failed to send message to server ${serverId}`, error);
      throw error;
    }
  }

  /**
   * Get the channel for a specific server
   * 
   * @param serverId - Discord server ID
   * @returns TextChannel or null if not found
   */
  getChannel(serverId: string): TextChannel | null {
    return this.channels.get(serverId) || null;
  }

  /**
   * Get all configured server IDs
   * 
   * @returns Array of server IDs
   */
  getServerIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Get a user by ID
   * 
   * @param userId - Discord user ID
   * @returns User object or null if not found
   */
  async getUser(userId: string): Promise<User | null> {
    try {
      return await this.client.users.fetch(userId);
    } catch (error) {
      logger.warn(`Failed to fetch user ${userId}`, error);
      return null;
    }
  }
}

