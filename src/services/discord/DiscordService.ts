import { Client, TextChannel, User } from 'discord.js';
import { logger } from '../../utils/logger';
import { MessageTracker } from './MessageTracker';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { BattleMessageTracker } from '../../utils/battleMessageTracker';

/**
 * Service for handling Discord-related operations
 */
export class DiscordService {
  private client: Client;
  private channels: Map<string, TextChannel> = new Map(); // serverId -> channel
  private messageTracker: MessageTracker;

  constructor(client: Client, messageTracker: MessageTracker) {
    this.client = client;
    this.messageTracker = messageTracker;
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
        logger.warn('No servers configured. Bot will start but will not send notifications until servers are configured via /bountybattles config set');
        return; // Exit early, no channels to initialize
      }

      logger.info(`Initializing Discord service for ${serverConfigs.length} server(s)...`);

      for (const [serverId, serverConfig] of serverConfigs) {
        // Initialize channel for bounty battles if configured
        if (serverConfig.bountyBattles?.channelId) {
          await this.initializeServerChannel(serverId, serverConfig.bountyBattles.channelId);
        }
      }

      if (this.channels.size === 0) {
        logger.warn('Failed to initialize any channels. Check your serverConfig.json configuration or add servers via /bountybattles config set');
      } else {
        logger.info(`Discord service initialized. Connected to ${this.channels.size} channel(s)`);
      }
      
      // Load persisted battle messages from battles.json
      await this.loadPersistedBattles();
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
   * Update or create a battle notification message
   * 
   * @param serverId - Discord server ID
   * @param roleIds - Array of role IDs to mention (only if bounty threshold is met)
   * @param battleId - Battle ID
   * @param battleMessage - Formatted battle message
   * @param totalBounty - Total bounty (attacker + defender) for threshold check
   */
  async updateBattleMessage(
    serverId: string,
    roleIds: string[],
    battleId: string,
    battleMessage: string,
    totalBounty: number = 0
  ): Promise<void> {
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
      const existingMessageId = this.messageTracker.getMessageId(serverId, battleId);

      if (!battleMessage || battleMessage.length === 0) {
        logger.warn(`No battle message provided for battle ${battleId}`);
        return;
      }

      // Check bounty threshold to determine if roles should be mentioned
      const serverConfig = ServerConfigManager.getServerConfig(serverId);
      const bountyThreshold = serverConfig?.bountyBattles?.bountyThreshold ?? 0;
      const shouldMentionRoles = totalBounty >= bountyThreshold;
      
      // Only mention roles if threshold is met
      const effectiveRoleIds = shouldMentionRoles ? roleIds : [];

      if (existingMessageId) {
        // Update existing message
        try {
          const message = await channel.messages.fetch(existingMessageId);
          
          // Always include role mentions to preserve Discord notifications (if threshold met)
          const mentions = effectiveRoleIds.length > 0
            ? effectiveRoleIds.map(roleId => `<@&${roleId}>`).join(' ')
            : '';
          
          const messageContent = mentions 
            ? `${mentions}\n\n${battleMessage}`
            : battleMessage;
          
          await message.edit(messageContent);
          logger.info(`Updated battle message for battle ${battleId} in server ${serverId}`);
        } catch (error) {
          // Message might have been deleted, create a new one
          logger.warn(`Failed to update message ${existingMessageId}, creating new message`, error);
          await this.createNewBattleMessage(channel, serverId, effectiveRoleIds, battleId, battleMessage);
        }
      } else {
        // Create new message
        await this.createNewBattleMessage(channel, serverId, effectiveRoleIds, battleId, battleMessage);
      }
    } catch (error) {
      logger.error(`Failed to update battle message for server ${serverId}`, error);
      throw error;
    }
  }

  /**
   * Create a new battle message
   */
  private async createNewBattleMessage(
    channel: TextChannel,
    serverId: string,
    roleIds: string[],
    battleId: string,
    battleMessage: string
  ): Promise<void> {
    const mentions = roleIds.length > 0
      ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
      : '';

    const messageContent = mentions 
      ? `${mentions}\n\n${battleMessage}`
      : battleMessage;

    const message = await channel.send(messageContent);
    this.messageTracker.setMessageId(serverId, battleId, message.id);
    
    // Persist to battles.json for recovery after restart
    BattleMessageTracker.setBattleMessage(serverId, battleId, message.id);

    if (roleIds.length > 0) {
      logger.info(`Created new battle message for battle ${battleId} in server ${serverId} (channel: ${channel.name})`);
    } else {
      logger.info(`Created new battle message (no roles mentioned) for battle ${battleId} in server ${serverId} (channel: ${channel.name})`);
    }
  }

  /**
   * Delete a battle message
   */
  async deleteBattleMessage(serverId: string, battleId: string): Promise<void> {
    let channel = this.channels.get(serverId);
    
    // If channel not initialized, try to initialize it now
    if (!channel) {
      const serverConfig = ServerConfigManager.getServerConfig(serverId);
      if (serverConfig?.bountyBattles?.channelId) {
        await this.initializeServerChannel(serverId, serverConfig.bountyBattles.channelId);
        channel = this.channels.get(serverId);
      }
    }
      
    if (!channel) {
      logger.warn(`Channel not initialized for server ${serverId}, cannot delete message`);
      return;
    }

    const messageId = this.messageTracker.getMessageId(serverId, battleId);
    if (!messageId) {
      logger.debug(`No message ID found for battle ${battleId} in server ${serverId}`);
      return;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      await message.delete();
      this.messageTracker.removeBattle(serverId, battleId);
      
      // Remove from battles.json
      BattleMessageTracker.removeBattleMessage(serverId, battleId);
      logger.info(`Deleted battle message for battle ${battleId} in server ${serverId}`);
    } catch (error) {
      logger.warn(`Failed to delete message ${messageId} for battle ${battleId}`, error);
      // Remove from tracker even if deletion failed (message might already be deleted)
      this.messageTracker.removeBattle(serverId, battleId);
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

  /**
   * Clear message tracking for a server
   * Used when server configuration changes (e.g., channel changed)
   * 
   * @param serverId - Discord server ID
   */
  clearServerTracking(serverId: string): void {
    this.messageTracker.clearServer(serverId);
    
    // Also clear from battles.json
    BattleMessageTracker.clearServer(serverId);
    
    logger.info(`Cleared message tracking for server ${serverId}`);
  }

  /**
   * Send a message to a specific channel
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

  /**
   * Load persisted battle messages from battles.json and restore in-memory tracking
   * Also validates that messages still exist and deletes stale entries
   */
  private async loadPersistedBattles(): Promise<void> {
    try {
      const battles = BattleMessageTracker.loadBattles();
      logger.info(`Loading ${battles.size} persisted battle message(s) from battles.json`);

      let restoredCount = 0;
      let deletedCount = 0;

      for (const entry of battles.values()) {
        try {
          // Initialize the channel if not already done
          const serverConfig = ServerConfigManager.getServerConfig(entry.serverId);
          if (!serverConfig) {
            logger.warn(`Server ${entry.serverId} not configured, removing battle ${entry.battleId}`);
            BattleMessageTracker.removeBattleMessage(entry.serverId, entry.battleId);
            deletedCount++;
            continue;
          }

          // Get or initialize the channel
          let channel = this.channels.get(entry.serverId);
          if (!channel && serverConfig.bountyBattles?.channelId) {
            await this.initializeServerChannel(entry.serverId, serverConfig.bountyBattles.channelId);
            channel = this.channels.get(entry.serverId);
          }

          if (!channel) {
            logger.warn(`Could not initialize channel for server ${entry.serverId}, removing battle ${entry.battleId}`);
            BattleMessageTracker.removeBattleMessage(entry.serverId, entry.battleId);
            deletedCount++;
            continue;
          }

          // Try to fetch the message to verify it still exists
          try {
            await channel.messages.fetch(entry.messageId);
            
            // Message exists, restore to in-memory tracker
            this.messageTracker.setMessageId(entry.serverId, entry.battleId, entry.messageId);
            restoredCount++;
            logger.debug(`Restored tracking for battle ${entry.battleId} in server ${entry.serverId}`);
          } catch (fetchError) {
            // Message no longer exists (deleted), remove from tracking
            logger.info(`Message ${entry.messageId} for battle ${entry.battleId} no longer exists, removing from tracking`);
            BattleMessageTracker.removeBattleMessage(entry.serverId, entry.battleId);
            deletedCount++;
          }
        } catch (error) {
          logger.error(`Error loading battle ${entry.battleId} for server ${entry.serverId}`, error);
        }
      }

      logger.info(`Restored ${restoredCount} battle message(s), removed ${deletedCount} stale message(s)`);
    } catch (error) {
      logger.error('Failed to load persisted battles', error);
      // Don't throw - bot should still start even if battles.json is missing/corrupt
    }
  }
}

