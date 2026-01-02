import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from 'discord.js';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { handleCountryNoPresident } from './country/nopresident';
import { handleCompanyProduction } from './company/production';

/**
 * Command builder for /scanfor
 */
export const scanForCommand = {
  data: new SlashCommandBuilder()
    .setName('scanfor')
    .setDescription('Scan large groups of objects and return results')
    .setContexts(InteractionContextType.Guild)
    .addSubcommandGroup(group =>
      group
        .setName('country')
        .setDescription('Scan countries')
        .addSubcommand(subcommand =>
          subcommand
            .setName('nopresident')
            .setDescription('Find all countries without an active president')
        )
    )
    .addSubcommandGroup(group =>
      group
        .setName('company')
        .setDescription('Scan companies')
        .addSubcommand(subcommand =>
          subcommand
            .setName('production')
            .setDescription('Count how many companies produce each item')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction, _discordService?: DiscordService, apiService?: ApiService): Promise<void> {
    try {
      // Ensure command is used in a guild
      if (!interaction.guildId) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      // Ensure apiService is provided
      if (!apiService) {
        await interaction.reply({
          content: 'API service is not available. Please contact an administrator.',
          ephemeral: true,
        });
        return;
      }

      const subcommandGroup = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand();

      if (subcommandGroup === 'country') {
        if (subcommand === 'nopresident') {
          await handleCountryNoPresident(interaction, apiService);
        }
      } else if (subcommandGroup === 'company') {
        if (subcommand === 'production') {
          await handleCompanyProduction(interaction, apiService);
        }
      }
    } catch (error) {
      logger.error('Error executing scanfor command', error);
      
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        });
      } else if (interaction.deferred) {
        await interaction.followUp({
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    }
  },
};
