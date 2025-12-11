import { Client, TextChannel, User } from 'discord.js';
import { logger } from '../utils/logger';
import { BotConfig } from '../config';
import { MessageTracker } from './messageTracker';
import { BattleChange } from './battleTracker';

/**
 * Service for handling Discord-related operations
 */
export class DiscordService {
  private client: Client;
  private config: BotConfig;
  private channels: Map<string, TextChannel> = new Map(); // serverId -> channel
  private messageTracker: MessageTracker;

  constructor(client: Client, config: BotConfig, messageTracker: MessageTracker) {
    this.client = client;
    this.config = config;
    this.messageTracker = messageTracker;
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
   * Update or create a battle notification message
   * 
   * @param serverId - Discord server ID
   * @param roleIds - Array of role IDs to mention (only on first message)
   * @param battleChange - Battle change information
   * @param countries - Map of countryId -> CountryDTO for displaying country names
   * @param regions - Map of regionId -> RegionDTO for displaying region names
   */
  async updateBattleMessage(
    serverId: string,
    roleIds: string[],
    battleChange: BattleChange,
    countries: Map<string, unknown>,
    regions: Map<string, unknown>
  ): Promise<void> {
    const channel = this.channels.get(serverId);
    
    if (!channel) {
      throw new Error(`Channel not initialized for server ${serverId}. Call initialize() first.`);
    }

    try {
      // Import formatter dynamically to avoid circular dependencies
      const { formatBattleMessage } = await import('../utils/battleFormatter');
      
      const battleId = battleChange.battle._id;
      const existingMessageId = this.messageTracker.getMessageId(serverId, battleId);

      // Format battle details with country and region information
      const battleMessage = formatBattleMessage(
        [battleChange.battle] as Parameters<typeof formatBattleMessage>[0],
        countries as Parameters<typeof formatBattleMessage>[1],
        regions as Parameters<typeof formatBattleMessage>[2],
        battleChange.changeType,
        battleChange.changeHistory
      );

      if (!battleMessage || battleMessage.length === 0) {
        logger.warn(`No battle message generated for battle ${battleId}`);
        return;
      }

      if (existingMessageId) {
        // Update existing message
        try {
          const message = await channel.messages.fetch(existingMessageId);
          await message.edit(battleMessage);
          logger.info(`Updated battle message for battle ${battleId} in server ${serverId}`);
        } catch (error) {
          // Message might have been deleted, create a new one
          logger.warn(`Failed to update message ${existingMessageId}, creating new message`, error);
          await this.createNewBattleMessage(channel, serverId, roleIds, battleId, battleMessage);
        }
      } else {
        // Create new message
        await this.createNewBattleMessage(channel, serverId, roleIds, battleId, battleMessage);
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
    const channel = this.channels.get(serverId);
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
}

