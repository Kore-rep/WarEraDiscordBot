import { Client, GatewayIntentBits, Events } from 'discord.js';
import { logger } from '../utils/logger';
import { BotConfig } from '../config/config';
import { ApiService } from '../services/api/ApiService';
import { DiscordService } from '../services/discord/DiscordService';
import { SchedulerService } from '../services/scheduler/SchedulerService';
import { BountyPollTask } from '../services/scheduler/tasks/BountyPollTask';
import { BountyCleanupTask } from '../services/scheduler/tasks/BountyCleanupTask';
import { BattleService } from '../services/battle/BattleService';
import { MercenaryContractService } from '../services/mercenary/MercenaryContractService';
import { UserTrackingService } from '../services/userTracking';
import { CountryTrackingService } from '../services/countryTracking/CountryTrackingService';
import { ProxyTrackingService } from '../services/proxyTracking/ProxyTrackingService';
import { LeaderboardService } from '../services/leaderboard/LeaderboardService';
import { SpectreService } from '../services/spectre/SpectreService';
import { CommandHandler } from '../commands';

/**
 * Main bot class that handles Discord connection and basic setup
 */
export class Bot {
  private client: Client;
  private config: BotConfig;
  private apiService: ApiService;
  private discordService: DiscordService;
  private battleService: BattleService;
  private mercenaryContractService: MercenaryContractService;
  private spectreService: SpectreService;
  private userTrackingService: UserTrackingService;
  private countryTrackingService: CountryTrackingService;
  private proxyTrackingService: ProxyTrackingService;
  private leaderboardService: LeaderboardService;
  private scheduler: SchedulerService;
  private commandHandler: CommandHandler;
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
    this.discordService = new DiscordService(this.client);
    this.battleService = new BattleService(this.discordService, this.apiService);
    this.mercenaryContractService = new MercenaryContractService(this.discordService, this.apiService);
    this.spectreService = new SpectreService(this.apiService, this.discordService);
    this.userTrackingService = new UserTrackingService(this.apiService.getClient(), this.discordService);
    this.countryTrackingService = new CountryTrackingService(this.apiService.getClient(), this.discordService, this.apiService);
    this.proxyTrackingService = new ProxyTrackingService(this.apiService.getClient(), this.discordService, this.apiService);
    this.leaderboardService = new LeaderboardService(this.discordService, this.apiService);

    // Set services on ApiService to avoid circular dependency
    this.apiService.setProxyTrackingService(this.proxyTrackingService);
    this.apiService.setLeaderboardService(this.leaderboardService);

    // The scheduler owns every periodic task; each runs on its own interval.
    this.scheduler = new SchedulerService([
      new BountyPollTask(
        config.polling.intervalMinutes,
        this.apiService,
        this.battleService,
        this.mercenaryContractService,
        this.spectreService
      ),
      new BountyCleanupTask(this.battleService, this.mercenaryContractService),
      this.userTrackingService,
      this.countryTrackingService,
      this.proxyTrackingService,
      this.leaderboardService,
    ]);


    this.commandHandler = new CommandHandler(this.client, config.discord.token, this.discordService, this.apiService);

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
        
        // Register slash commands
        await this.commandHandler.registerCommands();
        logger.info(`Registered ${this.commandHandler.getCommandCount()} slash commands`);
        
        // Set up interaction handler for slash commands
        this.commandHandler.setupInteractionHandler();

        // Start all periodic tasks (polling, tracking, leaderboards)
        this.scheduler.start();

        logger.info('Bot is ready; all scheduled tasks have started');
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

    // Stop all periodic tasks
    this.scheduler.stop();

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

