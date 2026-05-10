import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, InteractionContextType } from 'discord.js';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { TrackedCountry } from '../../config/config';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';

/**
 * Command builder for /country tracking
 */
export function createCommandBuilder(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild);
}

export const countryTrackingCommand = {
  data: createCommandBuilder('country', 'Manage country tracking')
    .addSubcommandGroup(group =>
      group
        .setName('tracking')
        .setDescription('Track country population and government')
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Start tracking a country for low population')
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('Channel to send notifications in')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
            )
            .addIntegerOption(option =>
              option
                .setName('warnthreshold')
                .setDescription('Population warn threshold (one-time alert)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)
            )
            .addIntegerOption(option =>
              option
                .setName('criticalthreshold')
                .setDescription('Population critical threshold (repeated alerts)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(50)
            )
            .addStringOption(option =>
              option
                .setName('countryid')
                .setDescription('The War Era country ID to track (required if no group specified)')
                .setRequired(false)
            )
            .addStringOption(option =>
              option
                .setName('mentions')
                .setDescription('Users/roles to mention (separate with spaces, e.g., @user1 @role1)')
                .setRequired(false)
            )
            .addStringOption(option =>
              option
                .setName('group')
                .setDescription('Country group name (alternative to countryid for tracking multiple countries)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('remove')
            .setDescription('Stop tracking countries')
            .addStringOption(option =>
              option
                .setName('countryid')
                .setDescription('The War Era country ID or name to stop tracking')
                .setRequired(false)
            )
            .addStringOption(option =>
              option
                .setName('group')
                .setDescription('Country group name to stop tracking (all countries in group)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('update')
            .setDescription('Update tracking settings for existing countries')
            .addStringOption(option =>
              option
                .setName('mentions')
                .setDescription('Users/roles to mention (separate with spaces, e.g., @user1 @role1)')
                .setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('countryid')
                .setDescription('The War Era country ID or name to update')
                .setRequired(false)
            )
            .addStringOption(option =>
              option
                .setName('group')
                .setDescription('Country group name to update (all countries in group)')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List all tracked countries and their status')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction, _discordService?: DiscordService, apiService?: ApiService): Promise<void> {
    try {
      // Ensure command is used in a guild
      if (!interaction.guildId) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
        });
        return;
      }

      // Ensure apiService is provided
      if (!apiService) {
        await interaction.reply({
          content: 'API service is not available. Please contact an administrator.',
        });
        return;
      }

      const subcommandGroup = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand();

      if (subcommandGroup === 'tracking') {
        if (subcommand === 'add') {
          await handleTrackingAdd(interaction, apiService);
        } else if (subcommand === 'remove') {
          await handleTrackingRemove(interaction);
        } else if (subcommand === 'update') {
          await handleTrackingUpdate(interaction);
        } else if (subcommand === 'list') {
          await handleTrackingList(interaction);
        }
      }
    } catch (error) {
      logger.error('Error executing country tracking command', error);
      
      if (!interaction.replied) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
        });
      }
    }
  },
};

/**
 * Handle /country tracking add
 */
async function handleTrackingAdd(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  const countryId = interaction.options.getString('countryid', false);
  const channel = interaction.options.getChannel('channel', true);
  const warnThreshold = interaction.options.getInteger('warnthreshold', true);
  const criticalThreshold = interaction.options.getInteger('criticalthreshold', true);
  const mentionsString = interaction.options.getString('mentions');
  const groupName = interaction.options.getString('group');
  const serverId = interaction.guildId!;

  // Validate that either countryid or group is provided
  if (!countryId && !groupName) {
    await interaction.reply({
      content: 'Please provide either a country ID or a group name to track.',
    });
    return;
  }

  // Validate that both countryid and group are not provided
  if (countryId && groupName) {
    await interaction.reply({
      content: 'Please provide either a country ID or a group name, not both.',
    });
    return;
  }

  // Validate channel type
  if (channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Please select a text channel.',
    });
    return;
  }

  // Validate thresholds
  if (criticalThreshold >= warnThreshold) {
    await interaction.reply({
      content: 'Critical threshold must be less than warn threshold.',
    });
    return;
  }

  // Defer reply since we'll be making API calls
  await interaction.deferReply();

  try {
    const apiClient = apiService.getClient();
    
    // Parse mention IDs from the mentions string
    let mentionIds: string[] | undefined;
    if (mentionsString) {
      const mentionMatches = mentionsString.matchAll(/<@[!&]?\d+>/g);
      mentionIds = Array.from(mentionMatches, m => m[0]);
      
      if (mentionIds.length === 0) {
        await interaction.editReply({
          content: 'Invalid mention format. Please use Discord mentions (e.g., @user @role).',
        });
        return;
      }
    }

    let countriesToTrack: Array<{id: string, name: string}> = [];

    if (groupName) {
      // Track all countries in the specified group
      const group = ServerConfigManager.getCountryGroup(serverId, groupName);
      
      if (!group) {
        await interaction.editReply({
          content: `Country group "**${groupName}**" not found. Use \`/countrygroup list\` to see available groups.`,
        });
        return;
      }

      if (group.countries.length === 0) {
        await interaction.editReply({
          content: `Country group "**${groupName}**" has no countries. Use \`/countrygroup add ${groupName}\` to add countries.`,
        });
        return;
      }

      // Add all countries from the group
      for (const country of group.countries) {
        countriesToTrack.push({
          id: country.countryId,
          name: country.countryName
        });
      }
    } else {
      // Single country - fetch its data to validate and get name
      const apiResponse = await apiClient.country.getCountryById(countryId!);
      const countryData = apiResponse.result.data;
      
      countriesToTrack.push({
        id: countryData._id,
        name: countryData.name
      });
    }

    const addedCountries: string[] = [];
    const updatedCountries: string[] = [];

    // Process each country
    for (const country of countriesToTrack) {
      const currentPopulation = await getCurrentPopulation(apiClient, country.id);
      const now = new Date();

      // Determine if country is already below warn threshold
      const isAlreadyBelowWarn = currentPopulation < warnThreshold;
      const isAlreadyBelowCritical = currentPopulation < criticalThreshold;

      // Create tracked country object
      const trackedCountry: TrackedCountry = {
        countryId: country.id,
        countryName: country.name,
        channelId: channel.id,
        populationWarnThreshold: warnThreshold,
        populationCriticalThreshold: criticalThreshold,
        mentionIds,
        warnReported: isAlreadyBelowWarn && !isAlreadyBelowCritical, // Mark as reported if already below warn but not critical
        lastChecked: now.toISOString(),
        lastPopulation: currentPopulation,
      };

      // Check if country was already being tracked
      const existingCountries = ServerConfigManager.getTrackedCountries(serverId);
      const wasAlreadyTracked = existingCountries.some(c => c.countryId === country.id);

      // Add to config
      ServerConfigManager.addTrackedCountry(serverId, trackedCountry);

      if (wasAlreadyTracked) {
        updatedCountries.push(country.name);
      } else {
        addedCountries.push(country.name);
      }

      // If country is already below critical threshold, send immediate notification
      if (isAlreadyBelowCritical) {
        try {
          await sendImmediateAlert(interaction, trackedCountry, currentPopulation, 'critical');
          logger.info(`Sent immediate critical alert for country ${country.id} (${country.name}) to channel ${channel.id}`);
        } catch (error) {
          logger.error(`Failed to send immediate critical alert for country ${country.id}`, error);
        }
      }
      // If below warn threshold but not critical, send warn alert
      else if (isAlreadyBelowWarn) {
        try {
          await sendImmediateAlert(interaction, trackedCountry, currentPopulation, 'warn');
          logger.info(`Sent immediate warn alert for country ${country.id} (${country.name}) to channel ${channel.id}`);
        } catch (error) {
          logger.error(`Failed to send immediate warn alert for country ${country.id}`, error);
        }
      }
    }

    // Build response message
    let replyMessage = '';
    
    if (addedCountries.length > 0) {
      replyMessage += `**Added country tracking:**\n${addedCountries.map(name => `- ${name}`).join('\n')}\n\n`;
    }
    
    if (updatedCountries.length > 0) {
      replyMessage += `**Updated country tracking:**\n${updatedCountries.map(name => `- ${name}`).join('\n')}\n\n`;
    }
    
    replyMessage += `**Configuration:**\n`;
    replyMessage += `- Notification channel: <#${channel.id}>\n`;
    replyMessage += `- Warn threshold: ${warnThreshold} (one-time alert)\n`;
    replyMessage += `- Critical threshold: ${criticalThreshold} (repeated alerts)\n`;
    
    if (mentionIds && mentionIds.length > 0) {
      const mentions = mentionIds.join(' ');
      replyMessage += `- Will mention: ${mentions}\n`;
    }

    if (groupName) {
      replyMessage += `- Added from group: **${groupName}**\n`;
    }

    await interaction.editReply({ content: replyMessage });
    logger.info(`Country tracking configured for ${countriesToTrack.length} countries in server ${serverId}`);
  } catch (error) {
    logger.error(`Failed to add country tracking`, error);
    await interaction.editReply({
      content: `Failed to fetch country data. Please verify the country ID is correct or the country group exists.`,
    });
  }
}

/**
 * Handle /country tracking remove
 */
async function handleTrackingRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const countryIdOrName = interaction.options.getString('countryid', false);
  const groupName = interaction.options.getString('group', false);
  const serverId = interaction.guildId!;

  // Validate that either countryid or group is provided
  if (!countryIdOrName && !groupName) {
    await interaction.reply({
      content: 'Please provide either a country ID or a group name to remove from tracking.',
    });
    return;
  }

  // Validate that both countryid and group are not provided
  if (countryIdOrName && groupName) {
    await interaction.reply({
      content: 'Please provide either a country ID or a group name, not both.',
    });
    return;
  }

  const trackedCountries = ServerConfigManager.getTrackedCountries(serverId);

  if (groupName) {
    // Remove all countries in the specified group
    const group = ServerConfigManager.getCountryGroup(serverId, groupName);
    
    if (!group) {
      await interaction.reply({
        content: `Country group "**${groupName}**" not found.`,
      });
      return;
    }

    // Find all tracked countries that belong to this group
    const countriesToRemove = trackedCountries.filter(tracked =>
      group.countries.some(groupCountry => groupCountry.countryId === tracked.countryId)
    );

    if (countriesToRemove.length === 0) {
      await interaction.reply({
        content: `No countries from group "**${groupName}**" are currently being tracked.`,
      });
      return;
    }

    // Remove all countries in the group
    let removedCount = 0;
    const removedCountries: string[] = [];

    for (const country of countriesToRemove) {
      const removed = ServerConfigManager.removeTrackedCountry(serverId, country.countryId);
      if (removed) {
        removedCount++;
        removedCountries.push(country.countryName);
        logger.info(`Country tracking removed: ${country.countryName} (${country.countryId}) from server ${serverId}`);
      }
    }

    if (removedCount > 0) {
      await interaction.reply({
        content: `Stopped tracking **${removedCount}** countries from group "**${groupName}**":\n${removedCountries.map(name => `- ${name}`).join('\n')}`,
      });
    } else {
      await interaction.reply({
        content: `Failed to remove countries from group "**${groupName}**" from tracking.`,
      });
    }
  } else {
    // Remove single country by ID or name
    const countryToRemove = trackedCountries.find(
      c => c.countryId === countryIdOrName || c.countryName.toLowerCase() === countryIdOrName!.toLowerCase()
    );

    if (!countryToRemove) {
      await interaction.reply({
        content: `Country \`${countryIdOrName}\` is not currently being tracked.`,
      });
      return;
    }

    const removed = ServerConfigManager.removeTrackedCountry(serverId, countryToRemove.countryId);

    if (removed) {
      await interaction.reply({
        content: `Stopped tracking country **${countryToRemove.countryName}** (\`${countryToRemove.countryId}\`).`,
      });
      logger.info(`Country tracking removed: ${countryToRemove.countryName} (${countryToRemove.countryId}) from server ${serverId}`);
    } else {
      await interaction.reply({
        content: `Failed to remove country \`${countryIdOrName}\` from tracking.`,
      });
    }
  }
}

/**
 * Handle /country tracking update
 */
async function handleTrackingUpdate(interaction: ChatInputCommandInteraction): Promise<void> {
  const mentionsString = interaction.options.getString('mentions', true);
  const countryIdOrName = interaction.options.getString('countryid', false);
  const groupName = interaction.options.getString('group', false);
  const serverId = interaction.guildId!;

  // Validate that either countryid or group is provided
  if (!countryIdOrName && !groupName) {
    await interaction.reply({
      content: 'Please provide either a country ID or a group name to update.',
    });
    return;
  }

  // Validate that both countryid and group are not provided
  if (countryIdOrName && groupName) {
    await interaction.reply({
      content: 'Please provide either a country ID or a group name, not both.',
    });
    return;
  }

  // Parse mention IDs from the mentions string
  let mentionIds: string[] | undefined;
  if (mentionsString) {
    const mentionMatches = mentionsString.matchAll(/<@[!&]?\d+>/g);
    mentionIds = Array.from(mentionMatches, m => m[0]);
    
    if (mentionIds.length === 0) {
      await interaction.reply({
        content: 'Invalid mention format. Please use Discord mentions (e.g., @user @role).',
      });
      return;
    }
  }

  const trackedCountries = ServerConfigManager.getTrackedCountries(serverId);

  if (groupName) {
    // Update all countries in the specified group
    const group = ServerConfigManager.getCountryGroup(serverId, groupName);
    
    if (!group) {
      await interaction.reply({
        content: `Country group "**${groupName}**" not found.`,
      });
      return;
    }

    // Find all tracked countries that belong to this group
    const countriesToUpdate = trackedCountries.filter(tracked =>
      group.countries.some(groupCountry => groupCountry.countryId === tracked.countryId)
    );

    if (countriesToUpdate.length === 0) {
      await interaction.reply({
        content: `No countries from group "**${groupName}**" are currently being tracked.`,
      });
      return;
    }

    // Update all countries in the group
    const updatedCountries: string[] = [];

    for (const country of countriesToUpdate) {
      const updatedCountry: TrackedCountry = {
        ...country,
        mentionIds
      };

      ServerConfigManager.addTrackedCountry(serverId, updatedCountry);
      updatedCountries.push(country.countryName);
      logger.info(`Updated mentions for tracked country: ${country.countryName} (${country.countryId}) in server ${serverId}`);
    }

    const mentions = mentionIds ? mentionIds.join(' ') : 'none';
    await interaction.reply({
      content: `Updated mentions for **${updatedCountries.length}** countries from group "**${groupName}**":\n` +
        `${updatedCountries.map(name => `- ${name}`).join('\n')}\n\n` +
        `New mentions: ${mentions}`,
    });
  } else {
    // Update single country by ID or name
    const countryToUpdate = trackedCountries.find(
      c => c.countryId === countryIdOrName || c.countryName.toLowerCase() === countryIdOrName!.toLowerCase()
    );

    if (!countryToUpdate) {
      await interaction.reply({
        content: `Country \`${countryIdOrName}\` is not currently being tracked.`,
      });
      return;
    }

    const updatedCountry: TrackedCountry = {
      ...countryToUpdate,
      mentionIds
    };

    ServerConfigManager.addTrackedCountry(serverId, updatedCountry);

    const mentions = mentionIds ? mentionIds.join(' ') : 'none';
    await interaction.reply({
      content: `Updated mentions for country **${countryToUpdate.countryName}** (\`${countryToUpdate.countryId}\`).\n\n` +
        `New mentions: ${mentions}`,
    });
    logger.info(`Updated mentions for tracked country: ${countryToUpdate.countryName} (${countryToUpdate.countryId}) in server ${serverId}`);
  }
}

/**
 * Handle /country tracking list
 */
async function handleTrackingList(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guildId!;
  const trackedCountries = ServerConfigManager.getTrackedCountries(serverId);

  if (trackedCountries.length === 0) {
    await interaction.reply({
      content: 'No countries are currently being tracked.\n\nUse `/country tracking add` to start tracking a country.',
    });
    return;
  }

  // Build list message
  let message = '**Tracked Countries**\n\n';
  
  for (const country of trackedCountries) {
    message += `**${country.countryName}** (\`${country.countryId}\`)\n`;
    message += `- Channel: <#${country.channelId}>\n`;
    message += `- Warn threshold: ${country.populationWarnThreshold}\n`;
    message += `- Critical threshold: ${country.populationCriticalThreshold}\n`;
    
    if (country.mentionIds && country.mentionIds.length > 0) {
      const mentions = country.mentionIds.join(' ');
      message += `- Mentions: ${mentions}\n`;
    }
    
    if (country.lastChecked) {
      const lastCheckedDate = new Date(country.lastChecked);
      message += `- Last checked: <t:${Math.floor(lastCheckedDate.getTime() / 1000)}:R>\n`;
    }
    
    if (country.lastPopulation !== undefined) {
      message += `- Current population: ${country.lastPopulation}`;
      
      if (country.lastPopulation < country.populationCriticalThreshold) {
        message += ` 🚨 **CRITICAL**`;
      } else if (country.lastPopulation < country.populationWarnThreshold) {
        if (country.warnReported) {
          message += ` ⚠️ **LOW** (reported)`;
        } else {
          message += ` ⚠️ **LOW**`;
        }
      } else {
        message += ` ✅`;
      }
      message += '\n';
    } else {
      message += `- Current population: Never checked\n`;
    }
    
    message += '\n';
  }

  await interaction.reply({
    content: message,
  });
}

/**
 * Send immediate alert when country is added and already below threshold
 */
async function sendImmediateAlert(
  interaction: ChatInputCommandInteraction, 
  trackedCountry: TrackedCountry, 
  currentPopulation: number, 
  alertType: 'warn' | 'critical'
): Promise<void> {
  // Build mention string only for critical alerts
  let mentionString = '';
  if (alertType === 'critical' && trackedCountry.mentionIds && trackedCountry.mentionIds.length > 0) {
    mentionString = trackedCountry.mentionIds.join(' ') + ' ';
  }

  const emoji = alertType === 'critical' ? '🚨' : '⚠️';
  const alertTitle = alertType === 'critical' ? 'CRITICAL Population Alert' : 'Warning: Low Population';
  const threshold = alertType === 'critical' ? trackedCountry.populationCriticalThreshold : trackedCountry.populationWarnThreshold;
  
  const notificationMessage = 
    `${mentionString}**${emoji} ${alertTitle}**\n\n` +
    `Country **${trackedCountry.countryName}** population is **${currentPopulation}**.\n` +
    `Threshold: ${threshold}\n\n` +
    `*This country was already below threshold when tracking was enabled.*`;

  // Send notification to the configured channel
  const notificationChannel = await interaction.client.channels.fetch(trackedCountry.channelId);
  if (notificationChannel && 'send' in notificationChannel) {
    await notificationChannel.send(notificationMessage);
  }
}

/**
 * Get current population for a country
 */
async function getCurrentPopulation(apiClient: any, countryId: string): Promise<number> {
  const response = await apiClient.country.getCountryById(countryId);
  return response.result.data.rankings?.countryActivePopulation?.value || 0;
}