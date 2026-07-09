import { Client, TextChannel, User, EmbedBuilder, DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { logger } from '../../utils/logger';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { splitMessage } from './messageChunker';

/** Optional extras for a channel send. */
export interface SendOptions {
  /** Role ids to mention; rendered as `<@&id>` on the first chunk only. */
  roleIds?: string[];
}

/**
 * Service for handling Discord-related operations
 */
export class DiscordService {
  private client: Client;
  private channels: Map<string, TextChannel> = new Map(); // serverId -> channel
  // Channel ids that failed to initialize (not found / not a text channel / fetch
  // error). Sends to these are skipped so we don't hammer Discord every task cycle
  // with requests we know will fail. Cleared for a channel once it initializes OK.
  private failedChannels: Set<string> = new Set();

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
        this.failedChannels.add(channelId);
        return;
          }

          if (!channel.isTextBased()) {
        logger.warn(`Channel with ID ${channelId} is not a text channel for server ${serverId}`);
        this.failedChannels.add(channelId);
        return;
          }

          this.channels.set(serverId, channel as TextChannel);
          this.failedChannels.delete(channelId);
          logger.info(`Initialized channel for server ${serverId}: ${(channel as TextChannel).name}`);
        } catch (error) {
          logger.error(`Failed to initialize channel for server ${serverId}`, error);
      this.failedChannels.add(channelId);
      // Don't throw - this is recoverable
    }
  }

  /**
   * Send a message to a channel by id. This is the single entry point for channel
   * sends: it optionally mentions roles (on the first chunk only) and automatically
   * splits content over Discord's 2000-char limit into multiple messages.
   *
   * @returns the id of the first message sent, or null if nothing was sent / it failed.
   */
  async sendToChannel(channelId: string, content: string, options: SendOptions = {}): Promise<string | null> {
    if (this.failedChannels.has(channelId)) {
      logger.debug(`Skipping send to channel ${channelId} - it failed to initialize`);
      return null;
    }
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        logger.error(`Channel ${channelId} is not a text channel`);
        this.failedChannels.add(channelId);
        return null;
      }
      const textChannel = channel as TextChannel;

      const mentions = (options.roleIds ?? [])
        .map(roleId => `<@&${roleId}>`)
        .join(' ');
      const body = mentions ? `${mentions}\n\n${content}` : content;

      const chunks = splitMessage(body);
      let firstMessageId: string | null = null;
      for (const chunk of chunks) {
        const sent = await textChannel.send(chunk);
        firstMessageId ??= sent.id;
      }

      logger.debug(`Sent ${chunks.length} message chunk(s) to channel ${channelId} (mentions: ${options.roleIds?.length ?? 0})`);
      return firstMessageId;
    } catch (error) {
      logger.error(`Failed to send message to channel ${channelId}`, error);
      if (this.isUnrecoverableChannelError(error)) {
        this.failedChannels.add(channelId);
      }
      return null;
    }
  }

  /**
   * Whether a channel error means the channel is gone or permanently inaccessible
   * (so retrying every cycle is pointless), versus a transient failure worth retrying.
   */
  private isUnrecoverableChannelError(error: unknown): boolean {
    return (
      error instanceof DiscordAPIError &&
      (error.code === RESTJSONErrorCodes.UnknownChannel ||
        error.code === RESTJSONErrorCodes.MissingAccess)
    );
  }

  /**
   * Send a bounty alert to a server's configured bounty-battles channel.
   */
  async sendBountyAlert(serverId: string, message: string, roleIds: string[] = []): Promise<string | null> {
    const channelId = ServerConfigManager.getServerConfig(serverId)?.bountyBattles?.channelId;
    if (!channelId) {
      logger.warn(`No bounty-battles channel configured for server ${serverId}`);
      return null;
    }
    return this.sendToChannel(channelId, message, { roleIds });
  }

  /**
   * Send a mercenary contract alert to a server's configured mercenary-contracts channel.
   */
  async sendMercenaryContractAlert(serverId: string, message: string, roleIds: string[] = []): Promise<string | null> {
    const channelId = ServerConfigManager.getServerConfig(serverId)?.mercenaryContracts?.channelId;
    if (!channelId) {
      logger.warn(`No mercenary-contracts channel configured for server ${serverId}`);
      return null;
    }
    return this.sendToChannel(channelId, message, { roleIds });
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

}

