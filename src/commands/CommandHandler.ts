import { Client, Events, REST, Routes, ChatInputCommandInteraction } from 'discord.js';
import { Command } from './types';
import { logger } from '../utils/logger';
import { DiscordService } from '../services/discord/DiscordService';
import { ApiService } from '../services/api/ApiService';

// Import all command groups
import { bountyBattlesCommand } from './bountyBattles';
import { userTrackingCommand } from './userTracking';
import { scanForCommand } from './scanFor';

/**
 * Manages slash command registration and execution
 */
export class CommandHandler {
  private commands: Map<string, Command> = new Map();
  private client: Client;
  private token: string;
  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(client: Client, token: string, discordService: DiscordService, apiService: ApiService) {
    this.client = client;
    this.token = token;
    this.discordService = discordService;
    this.apiService = apiService;
    this.loadCommands();
  }

  /**
   * Load all available commands
   */
  private loadCommands(): void {
    const commandList: Command[] = [
      bountyBattlesCommand,
      userTrackingCommand,
      scanForCommand,
      // Add more commands here as they are created
    ];

    for (const command of commandList) {
      this.commands.set(command.data.name, command);
      logger.info(`Loaded command: ${command.data.name}`);
    }
  }

  /**
   * Register slash commands with Discord
   * This should be called once when the bot starts
   */
  async registerCommands(): Promise<void> {
    try {
      const commandData = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());

      const rest = new REST().setToken(this.token);

      logger.info(`Registering ${commandData.length} slash commands...`);

      // Register commands globally (can take up to an hour to propagate)
      // For faster testing, you can register guild-specific commands instead
      await rest.put(
        Routes.applicationCommands(this.client.user!.id),
        { body: commandData }
      );

      logger.info('Successfully registered slash commands globally');
    } catch (error) {
      logger.error('Failed to register slash commands', error);
      throw error;
    }
  }

  /**
   * Set up interaction handler for slash commands
   */
  setupInteractionHandler(): void {
    this.client.on(Events.InteractionCreate, async (interaction) => {
      // Only handle chat input commands (slash commands)
      if (!interaction.isChatInputCommand()) {
        return;
      }

      await this.handleCommand(interaction);
    });

    logger.info('Interaction handler set up successfully');
  }

  /**
   * Handle a slash command interaction
   */
  private async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      await interaction.reply({
        content: 'Unknown command.',
        ephemeral: true,
      });
      return;
    }

    try {
      logger.info(
        `Executing command: ${interaction.commandName} by ${interaction.user.tag} in guild ${interaction.guildId}`
      );
      await command.execute(interaction, this.discordService, this.apiService);
    } catch (error) {
      logger.error(`Error executing command: ${interaction.commandName}`, error);

      const errorMessage = 'There was an error executing this command.';
      
      // If we haven't replied yet, reply with error
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: errorMessage,
          ephemeral: true,
        });
      } else if (interaction.deferred) {
        // If we deferred, follow up with error
        await interaction.followUp({
          content: errorMessage,
          ephemeral: true,
        });
      }
    }
  }

  /**
   * Get the number of loaded commands
   */
  getCommandCount(): number {
    return this.commands.size;
  }
}
