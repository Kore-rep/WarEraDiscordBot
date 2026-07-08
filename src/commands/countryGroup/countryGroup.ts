import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  InteractionContextType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { ScanService } from '../../services/scan/ScanService';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { CountryGroup, GroupedCountry } from '../../config/config';

/**
 * Command builder for /countrygroup
 */
export const countryGroupCommand = {
  data: new SlashCommandBuilder()
    .setName('countrygroup')
    .setDescription('Manage country groups for filtered scans')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new country group')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name for the country group')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all country groups')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('view')
        .setDescription('View details of a country group')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name of the country group to view')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add countries to an existing group')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name of the country group')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove countries from a group')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name of the country group')
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a country group')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Name of the country group to delete')
            .setRequired(true)
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

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'create') {
        await handleCreate(interaction);
      } else if (subcommand === 'list') {
        await handleList(interaction);
      } else if (subcommand === 'view') {
        await handleView(interaction);
      } else if (subcommand === 'add') {
        await handleAdd(interaction);
      } else if (subcommand === 'remove') {
        await handleRemove(interaction);
      } else if (subcommand === 'delete') {
        await handleDelete(interaction);
      }
    } catch (error) {
      logger.error('Error executing countrygroup command', error);
      
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

/**
 * Handle /countrygroup create
 */
async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const groupName = interaction.options.getString('name', true);
  const serverId = interaction.guildId!;

  // Check if group already exists
  const existingGroup = ServerConfigManager.getCountryGroup(serverId, groupName);
  if (existingGroup) {
    await interaction.reply({
      content: `A country group named "**${groupName}**" already exists.`,
      ephemeral: true,
    });
    return;
  }

  // Show modal for entering country names
  const modal = new ModalBuilder()
    .setCustomId(`countrygroup-create-${groupName}`)
    .setTitle(`Create Country Group: ${groupName}`);

  const countryNamesInput = new TextInputBuilder()
    .setCustomId('countryNames')
    .setLabel('Country Names (comma-separated)')
    .setPlaceholder('France, Germany, Italy, ...\nSee warera.wiki/country for full list')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(countryNamesInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal);
}

/**
 * Handle /countrygroup list
 */
async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guildId!;
  const groups = ServerConfigManager.getCountryGroups(serverId);

  if (groups.length === 0) {
    await interaction.reply({
      content: 'No country groups found.\n\nUse `/countrygroup create` to create a new group.',
      ephemeral: true,
    });
    return;
  }

  let message = '**Country Groups**\n\n';
  
  for (const group of groups) {
    const createdDate = new Date(group.createdAt);
    message += `📁 **${group.name}** (${group.countries.length} ${group.countries.length === 1 ? 'country' : 'countries'})\n`;
    message += `   Created: <t:${Math.floor(createdDate.getTime() / 1000)}:R>\n\n`;
  }

  message += `\nUse \`/countrygroup view <name>\` to see countries in a group.`;

  await interaction.reply({
    content: message,
    ephemeral: true,
  });
}

/**
 * Handle /countrygroup view
 */
async function handleView(interaction: ChatInputCommandInteraction): Promise<void> {
  const groupName = interaction.options.getString('name', true);
  const serverId = interaction.guildId!;

  const group = ServerConfigManager.getCountryGroup(serverId, groupName);
  if (!group) {
    await interaction.reply({
      content: `Country group "**${groupName}**" not found.`,
      ephemeral: true,
    });
    return;
  }

  const createdDate = new Date(group.createdAt);
  const updatedDate = new Date(group.updatedAt);

  let message = `**Country Group: ${group.name}**\n\n`;
  message += `**Details:**\n`;
  message += `- Countries: ${group.countries.length}\n`;
  message += `- Created: <t:${Math.floor(createdDate.getTime() / 1000)}:R>\n`;
  message += `- Last updated: <t:${Math.floor(updatedDate.getTime() / 1000)}:R>\n\n`;

  if (group.countries.length > 0) {
    message += `**Countries:**\n`;
    const maxCountriesToShow = 20;
    const countriesToShow = group.countries.slice(0, maxCountriesToShow);

    for (const country of countriesToShow) {
      message += `- ${country.countryName} (\`${country.countryId}\`)\n`;
    }

    if (group.countries.length > maxCountriesToShow) {
      message += `\n_...and ${group.countries.length - maxCountriesToShow} more._`;
    }
  }

  await interaction.reply({
    content: message,
    ephemeral: true,
  });
}

/**
 * Handle /countrygroup add
 */
async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const groupName = interaction.options.getString('name', true);
  const serverId = interaction.guildId!;

  const group = ServerConfigManager.getCountryGroup(serverId, groupName);
  if (!group) {
    await interaction.reply({
      content: `Country group "**${groupName}**" not found.`,
      ephemeral: true,
    });
    return;
  }

  // Show modal for entering country names
  const modal = new ModalBuilder()
    .setCustomId(`countrygroup-add-${groupName}`)
    .setTitle(`Add Countries to: ${groupName}`);

  const countryNamesInput = new TextInputBuilder()
    .setCustomId('countryNames')
    .setLabel('Country Names (comma-separated)')
    .setPlaceholder('France, Germany, Italy, ...\nSee warera.wiki/country for full list')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(countryNamesInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal);
}

/**
 * Handle /countrygroup remove
 */
async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const groupName = interaction.options.getString('name', true);
  const serverId = interaction.guildId!;

  const group = ServerConfigManager.getCountryGroup(serverId, groupName);
  if (!group) {
    await interaction.reply({
      content: `Country group "**${groupName}**" not found.`,
      ephemeral: true,
    });
    return;
  }

  // Show modal for entering country names to remove
  const modal = new ModalBuilder()
    .setCustomId(`countrygroup-remove-${groupName}`)
    .setTitle(`Remove Countries from: ${groupName}`);

  const countryNamesInput = new TextInputBuilder()
    .setCustomId('countryNames')
    .setLabel('Country Names (comma-separated)')
    .setPlaceholder('France, Germany, Italy, ...\nSee warera.wiki/country for full list')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(countryNamesInput);
  modal.addComponents(actionRow);

  await interaction.showModal(modal);
}

/**
 * Handle /countrygroup delete
 */
async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const groupName = interaction.options.getString('name', true);
  const serverId = interaction.guildId!;

  const deleted = ServerConfigManager.deleteCountryGroup(serverId, groupName);

  if (deleted) {
    await interaction.reply({
      content: `Deleted country group "**${groupName}**".`,
      ephemeral: true,
    });
    logger.info(`Country group "${groupName}" deleted from server ${serverId}`);
  } else {
    await interaction.reply({
      content: `Country group "**${groupName}**" not found.`,
      ephemeral: true,
    });
  }
}

/**
 * Handle modal submit for country group operations
 * This is called from CommandHandler when a modal is submitted
 */
export async function handleCountryGroupModal(interaction: any, apiService: ApiService): Promise<void> {
  const customId = interaction.customId;
  const serverId = interaction.guildId!;

  // Parse the custom ID: countrygroup-<action>-<groupName>
  const parts = customId.split('-');
  if (parts.length < 3 || parts[0] !== 'countrygroup') {
    return;
  }

  const action = parts[1];
  const groupName = parts.slice(2).join('-'); // Rejoin in case group name had hyphens

  // Get the country names from the modal
  const countryNamesInput = interaction.fields.getTextInputValue('countryNames');
  const countryNames = countryNamesInput
    .split(',')
    .map((name: string) => name.trim())
    .filter((name: string) => name.length > 0);

  if (countryNames.length === 0) {
    await interaction.reply({
      content: 'No country names provided.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch all countries from API
    const allCountries = await new ScanService(apiService).getAllCountries(60000 * 60);

    // Match country names (case-insensitive)
    const matchedCountries: GroupedCountry[] = [];
    const unmatchedNames: string[] = [];

    for (const inputName of countryNames) {
      const country = allCountries.find(
        c => c.name.toLowerCase() === inputName.toLowerCase()
      );

      if (country) {
        matchedCountries.push({
          countryId: country._id,
          countryName: country.name,
        });
      } else {
        unmatchedNames.push(inputName);
      }
    }

    if (matchedCountries.length === 0) {
      await interaction.editReply({
        content: `None of the provided country names were found. Please check spelling and try again.\n\nUnmatched: ${unmatchedNames.join(', ')}\n\n📖 Reference: https://warera.wiki/country`,
      });
      return;
    }

    // Perform the action
    if (action === 'create') {
      const newGroup: CountryGroup = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        name: groupName,
        countries: matchedCountries,
        createdBy: interaction.user.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      ServerConfigManager.createCountryGroup(serverId, newGroup);

      let message = `Created country group "**${groupName}**" with ${matchedCountries.length} ${matchedCountries.length === 1 ? 'country' : 'countries'}.\n\n`;
      
      if (unmatchedNames.length > 0) {
        message += `⚠️ **Warning:** The following country names were not found: ${unmatchedNames.join(', ')}\n\n`;
        message += `📖 Reference: https://warera.wiki/country`;
      }

      await interaction.editReply({ content: message });
    } else if (action === 'add') {
      ServerConfigManager.addCountriesToGroup(serverId, groupName, matchedCountries);

      let message = `Added ${matchedCountries.length} ${matchedCountries.length === 1 ? 'country' : 'countries'} to group "**${groupName}**".\n\n`;
      
      if (unmatchedNames.length > 0) {
        message += `⚠️ **Warning:** The following country names were not found: ${unmatchedNames.join(', ')}\n\n`;
        message += `📖 Reference: https://warera.wiki/country`;
      }

      await interaction.editReply({ content: message });
    } else if (action === 'remove') {
      const countryIdsToRemove = matchedCountries.map(c => c.countryId);
      ServerConfigManager.removeCountriesFromGroup(serverId, groupName, countryIdsToRemove);

      await interaction.editReply({
        content: `Removed ${matchedCountries.length} ${matchedCountries.length === 1 ? 'country' : 'countries'} from group "**${groupName}**".`,
      });
    }
  } catch (error) {
    logger.error('Failed to process country group modal', error);
    await interaction.editReply({
      content: 'An error occurred while processing the country names. Please try again.',
    });
  }
}
