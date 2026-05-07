import { SlashCommandBuilder, ChatInputCommandInteraction, InteractionContextType } from 'discord.js';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { handleCountryNoGovernment } from './country/nogovernment';
import { handleCountryLowPop } from './country/lowpop';
import { handleCountryEthicsScan } from './country/ethics';
import { ETHIC_SLASH_CHOICES } from './country/partyEthicsMapping';
import { handleCountryBuilds } from './country/builds';
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
            .setName('nogovernment')
            .setDescription('Find countries with no or partial governments approaching inactivity')
            .addStringOption(option =>
              option
                .setName('group')
                .setDescription('Filter to a specific country group (optional)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('lowpop')
            .setDescription('List countries with active population below a threshold')
            .addIntegerOption(option =>
              option
                .setName('max_citizens')
                .setDescription('Return countries with active population strictly less than this number')
                .setRequired(true)
                .setMinValue(0)
            )
            .addStringOption(option =>
              option
                .setName('group')
                .setDescription('Filter to a specific country group (optional)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('ethics')
            .setDescription('Find countries whose ruling party matches a given ethic label')
            .addStringOption(option =>
              option
                .setName('ethic')
                .setDescription('Ruling party ethic to match')
                .setRequired(true)
                .addChoices(...ETHIC_SLASH_CHOICES)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('builds')
            .setDescription('Analyze player builds and modes for a country')
            .addStringOption(option =>
              option
                .setName('country')
                .setDescription('Country name or ID')
                .setRequired(true)
            )
            .addIntegerOption(option =>
              option
                .setName('min_level')
                .setDescription('Minimum player level to include')
                .setRequired(true)
                .setMinValue(1)
            )
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
            .addStringOption(option =>
              option
                .setName('country')
                .setDescription('Filter to companies in a specific country (optional)')
                .setRequired(false)
            )
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
        if (subcommand === 'nogovernment') {
          await handleCountryNoGovernment(interaction, apiService);
        } else if (subcommand === 'lowpop') {
          await handleCountryLowPop(interaction, apiService);
        } else if (subcommand === 'ethics') {
          await handleCountryEthicsScan(interaction, apiService);
        } else if (subcommand === 'builds') {
          await handleCountryBuilds(interaction, apiService);
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
