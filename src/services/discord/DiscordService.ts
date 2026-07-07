import { Client, TextChannel, User, EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger';
import { ServerConfigManager } from '../../utils/serverConfigManager';

/**
 * Service for handling Discord-related operations
 */
export class DiscordService {
  private client: Client;
  private channels: Map<string, TextChannel> = new Map(); // serverId -> channel

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Initialize the Discord service by fetching all configured channels
   * Re-reads the server configuration from ServerConfigManager to get latest config
   */
  async initialize(): Promise<void> {
    try {
      // Read latest server configurations from ServerConfigManager
      const servers = ServerConfigManager.readServerConfigs();
      const serverConfigs = Array.from(servers.entries());
      
      if (serverConfigs.length === 0) {
        logger.warn('No servers configured. Bot will start but will not send notifications until servers are configured via /bountybattles or /contracts config set');
        return; // Exit early, no channels to initialize
      }

      logger.info(`Initializing Discord service for ${serverConfigs.length} server(s)...`);

      for (const [serverId, serverConfig] of serverConfigs) {
        // Initialize channel for bounty battles if configured
        if (serverConfig.bountyBattles?.channelId) {
          await this.initializeServerChannel(serverId, serverConfig.bountyBattles.channelId);
        }
        
        // Initialize channel for mercenary contracts if configured
        if (serverConfig.mercenaryContracts?.channelId) {
          await this.initializeServerChannel(serverId, serverConfig.mercenaryContracts.channelId);
        }
      }

      if (this.channels.size === 0) {
        logger.warn('Failed to initialize any channels. Check your serverConfig.json configuration or add servers via /bountybattles or /contracts config set');
      } else {
        logger.info(`Discord service initialized. Connected to ${this.channels.size} channel(s)`);
      }
    } catch (error) {
      logger.error('Failed to initialize Discord service', error);
      throw error;
    }
  }

  /**
   * Initialize or update a channel for a specific server
   * Can be called when a server is configured via slash command
   */
  async initializeServerChannel(serverId: string, channelId: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
          
          if (!channel) {
        logger.warn(`Channel with ID ${channelId} not found for server ${serverId}`);
        return;
          }

          if (!channel.isTextBased()) {
        logger.warn(`Channel with ID ${channelId} is not a text channel for server ${serverId}`);
        return;
          }

          this.channels.set(serverId, channel as TextChannel);
          logger.info(`Initialized channel for server ${serverId}: ${(channel as TextChannel).name}`);
        } catch (error) {
          logger.error(`Failed to initialize channel for server ${serverId}`, error);
      // Don't throw - this is recoverable
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
   * Send a bounty alert message with optional role mentions (fire-and-forget, no tracking)
   * Used by the simplified bounty system that doesn't track or update messages
   * 
   * @param serverId - Discord server ID
   * @param message - Formatted bounty alert message
   * @param roleIds - Array of role IDs to mention (if threshold is met)
   */
  async sendBountyAlert(serverId: string, message: string, roleIds: string[] = []): Promise<void> {
    let channel = this.channels.get(serverId);
    
    // If channel not initialized, try to initialize it now
    if (!channel) {
      const serverConfig = ServerConfigManager.getServerConfig(serverId);
      if (serverConfig?.bountyBattles?.channelId) {
        await this.initializeServerChannel(serverId, serverConfig.bountyBattles.channelId);
        channel = this.channels.get(serverId);
      }
    
      if (!channel) {
        throw new Error(`Channel not initialized for server ${serverId}. Server may not be configured or channel is invalid.`);
      }
    }

    try {
      // Build role mentions if provided
      const mentions = roleIds.length > 0
        ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
        : '';
      
      // Combine mentions with message
      const finalMessage = mentions 
        ? `${mentions}\n\n${message}`
        : message;

      // Send the alert (fire-and-forget, no tracking)
      await channel.send(finalMessage);
      
      logger.info(`Sent bounty alert to server ${serverId} (channel: ${channel.name}, mentions: ${roleIds.length})`);
    } catch (error) {
      logger.error(`Failed to send bounty alert to server ${serverId}`, error);
      throw error;
    }
  }

  /**
   * Send a mercenary contract alert message with optional role mentions (fire-and-forget, no tracking)
   * Uses the mercenary contracts channel configured for the server
   * 
   * @param serverId - Discord server ID
   * @param message - Formatted mercenary contract alert message
   * @param roleIds - Array of role IDs to mention
   */
  async sendMercenaryContractAlert(serverId: string, message: string, roleIds: string[] = []): Promise<void> {
    try {
      const serverConfig = ServerConfigManager.getServerConfig(serverId);
      if (!serverConfig?.mercenaryContracts?.channelId) {
        throw new Error(`Mercenary contracts channel not configured for server ${serverId}`);
      }

      // Fetch the mercenary contracts channel dynamically
      const channel = await this.client.channels.fetch(serverConfig.mercenaryContracts.channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Mercenary contracts channel ${serverConfig.mercenaryContracts.channelId} is not a valid text channel for server ${serverId}`);
      }

      // Build role mentions if provided
      const mentions = roleIds.length > 0
        ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
        : '';
      
      // Combine mentions with message
      const finalMessage = mentions 
        ? `${mentions}\n\n${message}`
        : message;

      // Send the alert (fire-and-forget, no tracking)
      await (channel as TextChannel).send(finalMessage);
      
      logger.info(`Sent mercenary contract alert to server ${serverId} (channel: ${(channel as TextChannel).name}, mentions: ${roleIds.length})`);
    } catch (error) {
      logger.error(`Failed to send mercenary contract alert to server ${serverId}`, error);
      throw error;
    }
  }

  /**
   * Send a message to a channel by ID (fetch). Used when the target is not the server's default bounty channel.
   */
  async sendMessageToChannelById(channelId: string, message: string): Promise<void> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel`);
      }
      await (channel as TextChannel).send(message);
      logger.debug(`Sent message to channel ${channelId}`);
    } catch (error) {
      logger.error(`Failed to send message to channel ${channelId}`, error);
      throw error;
    }
  }

  /**
   * Create or edit the living leaderboard message in a channel
   */
  async updateLeaderboardMessage(
    channelId: string,
    messageId: string | undefined,
    content: string,
    embeds: EmbedBuilder[]
  ): Promise<string> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        throw new Error(`Channel ${channelId} is not a text channel`);
      }

      const textChannel = channel as TextChannel;

      if (messageId) {
        try {
          const message = await textChannel.messages.fetch(messageId);
          await message.edit({ content, embeds });
          logger.debug(`Updated leaderboard message ${messageId} in channel ${channelId}`);
          return messageId;
        } catch (error) {
          logger.warn(`Leaderboard message ${messageId} not found, creating a new one`, error);
        }
      }

      const sent = await textChannel.send({ content, embeds });
      logger.debug(`Created leaderboard message ${sent.id} in channel ${channelId}`);
      return sent.id;
    } catch (error) {
      logger.error(`Failed to update leaderboard message in channel ${channelId}`, error);
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

  /**
   * Send a message to a specific channel by ID within a server context.
   *
   * @param serverId - Discord server ID
   * @param channelId - Discord channel ID
   * @param content - Message content
   * @returns Message ID if successful, null otherwise
   */
  async sendMessageToChannel(serverId: string, channelId: string, content: string): Promise<string | null> {
    try {
      // Try to get channel from cache first
      let channel = this.channels.get(serverId);
      
      // If not in cache or different channel, fetch it
      if (!channel || channel.id !== channelId) {
        const fetchedChannel = await this.client.channels.fetch(channelId);
        if (!fetchedChannel?.isTextBased()) {
          logger.error(`Channel ${channelId} is not a text channel`);
          return null;
        }
        channel = fetchedChannel as TextChannel;
      }

      const message = await channel.send(content);
      logger.debug(`Sent message to channel ${channelId} in server ${serverId}`);
      return message.id;
    } catch (error) {
      logger.error(`Failed to send message to channel ${channelId} in server ${serverId}`, error);
      return null;
    }
  }
}

