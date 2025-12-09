import { Client, GatewayIntentBits, Events } from 'discord.js';
import { logger } from './utils/logger';
import { BotConfig } from './config';
import { ApiService } from './services/apiService';
import { DiscordService } from './services/discordService';
import { PollingService } from './services/pollingService';

/**
 * Main bot class that handles Discord connection and basic setup
 */
export class Bot {
  private client: Client;
  private config: BotConfig;
  private apiService: ApiService;
  private discordService: DiscordService;
  private pollingService: PollingService;
  private isRunning = false;

  constructor(config: BotConfig) {
    this.config = config;

    // Create Discord client with necessary intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Initialize services
    this.apiService = new ApiService(config);
    this.discordService = new DiscordService(this.client, config);
    this.pollingService = new PollingService(
      config,
      this.apiService,
      this.discordService
    );

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up Discord client event handlers
   */
  private setupEventHandlers(): void {
    // Handle client ready event
    this.client.once(Events.ClientReady, async (readyClient) => {
      logger.info(`Bot logged in as ${readyClient.user.tag}`);
      
      try {
        // Initialize Discord service (fetch channel)
        await this.discordService.initialize();
        
        // Start periodic polling via polling service
        this.pollingService.start();
        
        logger.info('Bot is ready and polling has started');
      } catch (error) {
        logger.error('Failed to initialize bot services', error);
        // Don't exit - let the bot try to recover
      }
    });

    // Handle errors
    this.client.on(Events.Error, (error) => {
      logger.error('Discord client error', error);
    });

    // Handle disconnects
    this.client.on(Events.ShardDisconnect, () => {
      logger.warn('Discord client disconnected');
    });

    // Handle reconnects
    this.client.on(Events.ShardReconnecting, () => {
      logger.info('Discord client reconnected');
    });

    // Handle warnings
    this.client.on(Events.Warn, (warning) => {
      logger.warn('Discord client warning', warning);
    });
  }

  /**
   * Start the bot by connecting to Discord
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Bot is already running');
      return;
    }

    try {
      logger.info('Starting bot...');
      await this.client.login(this.config.discord.token);
      this.isRunning = true;
    } catch (error) {
      logger.error('Failed to start bot', error);
      throw error;
    }
  }

  /**
   * Stop the bot and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping bot...');

    // Stop polling service
    this.pollingService.stop();

    // Destroy Discord client
    this.client.destroy();
    this.isRunning = false;

    logger.info('Bot stopped');
  }

  /**
   * Get the Discord client instance (useful for adding slash commands later)
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Get the API service instance
   */
  getApiService(): ApiService {
    return this.apiService;
  }

  /**
   * Get the Discord service instance
   */
  getDiscordService(): DiscordService {
    return this.discordService;
  }
}

