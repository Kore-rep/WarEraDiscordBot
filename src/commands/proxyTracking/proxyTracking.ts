import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, InteractionContextType } from 'discord.js';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { TrackedProxyCountry, ProxyUser } from '../../config/config';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { ScanService } from '../../services/scan/ScanService';
import { COMMAND_HELP } from '../help/helpTexts';

/**
 * Command builder for /proxy tracking
 */
export function createCommandBuilder(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild);
}

export const proxyTrackingCommand = {
  data: createCommandBuilder('proxy', 'Manage proxy tracking')
    .addSubcommandGroup(group =>
      group
        .setName('tracking')
        .setDescription('Track proxy users and countries')
        .addSubcommand(subcommand =>
          subcommand
            .setName('toggle')
            .setDescription('Enable or disable proxy tracking for a country')
            .addStringOption(option =>
              option
                .setName('countryid')
                .setDescription('The War Era country ID to track')
                .setRequired(true)
            )
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('Channel to send proxy notifications in')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
            )
            .addStringOption(option =>
              option
                .setName('mentions')
                .setDescription('Users/roles to mention (separate with spaces, e.g., @user1 @role1)')
                .setRequired(false)
            )
            .addBooleanOption(option =>
              option
                .setName('enabled')
                .setDescription('Enable or disable tracking for this country')
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List all tracked proxies with cooldown and population info')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Manually add a proxy user (current country will be detected automatically)')
            .addStringOption(option =>
              option
                .setName('userid')
                .setDescription('The War Era user ID of the proxy')
                .setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('originalcountryid')
                .setDescription('The original country ID they left')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('remove')
            .setDescription('Remove a proxy user from tracking')
            .addStringOption(option =>
              option
                .setName('userid')
                .setDescription('The War Era user ID to remove')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('status')
            .setDescription('Show proxy tracking status for this server')
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('help').setDescription('How proxy tracking works')
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

      if (!subcommandGroup && subcommand === 'help') {
        await interaction.reply({ content: COMMAND_HELP.proxy, ephemeral: true });
      } else if (subcommandGroup === 'tracking') {
        if (subcommand === 'toggle') {
          await handleTrackingToggle(interaction, apiService);
        } else if (subcommand === 'list') {
          await handleTrackingList(interaction, apiService);
        } else if (subcommand === 'add') {
          await handleTrackingAdd(interaction, apiService);
        } else if (subcommand === 'remove') {
          await handleTrackingRemove(interaction);
        } else if (subcommand === 'status') {
          await handleTrackingStatus(interaction);
        }
      }
    } catch (error) {
      logger.error('Error executing proxy tracking command', error);
      
      if (!interaction.replied) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
        });
      }
    }
  },
};

/**
 * Handle /proxy tracking toggle
 */
async function handleTrackingToggle(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  const countryId = interaction.options.getString('countryid', true);
  const channel = interaction.options.getChannel('channel', true);
  const mentionsString = interaction.options.getString('mentions');
  const enabled = interaction.options.getBoolean('enabled') ?? true;
  const serverId = interaction.guildId!;

  // Validate channel type
  if (channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Please select a text channel.',
    });
    return;
  }

  // Defer reply since we'll be making an API call
  await interaction.deferReply();

  try {
    // Fetch country data from API to get country name
    const countryData = await new ScanService(apiService).getCountryById(countryId);
    if (!countryData) {
      await interaction.editReply({ content: `Could not fetch data for country \`${countryId}\`.` });
      return;
    }
    const countryName = countryData.name;

    // Parse mentions
    const mentionIds: string[] = [];
    if (mentionsString) {
      const mentions = mentionsString.split(' ').filter(m => m.trim());
      mentionIds.push(...mentions);
    }

    // Create tracked proxy country object
    const trackedCountry: TrackedProxyCountry = {
      countryId,
      countryName,
      channelId: channel.id,
      enabled,
      mentionIds,
      lastChecked: undefined,
      initialUsers: undefined
    };

    // If enabling for the first time, get initial users
    if (enabled) {
      const proxyTrackingService = apiService.getProxyTrackingService?.();
      if (proxyTrackingService) {
        try {
          const initialUsers = await proxyTrackingService.initializeCountryTracking(countryId);
          trackedCountry.initialUsers = initialUsers;
          logger.info(`Initialized proxy tracking for ${countryName} with ${initialUsers.length} users`);
        } catch (error) {
          logger.warn(`Could not initialize user list for ${countryName}:`, error);
        }
      }
    }

    // Add to server configuration
    ServerConfigManager.addTrackedProxyCountry(serverId, trackedCountry);

    let message = `✅ **Proxy tracking ${enabled ? 'enabled' : 'disabled'}** for **${countryName}**\n\n`;
    message += `**Channel:** <#${channel.id}>\n`;
    if (mentionIds.length > 0) {
      message += `**Mentions:** ${mentionIds.join(' ')}\n`;
    }
    if (enabled && trackedCountry.initialUsers) {
      message += `**Baseline Users:** ${trackedCountry.initialUsers.length} users stored for comparison\n`;
    }

    await interaction.followUp({ content: message });

  } catch (error: any) {
    logger.error('Error in proxy tracking toggle:', error);
    
    let errorMessage = 'An error occurred while setting up proxy tracking.';
    if (error.response?.status === 404) {
      errorMessage = `Country with ID "${countryId}" not found. Please check the country ID and try again.`;
    }
    
    await interaction.followUp({ content: errorMessage });
  }
}

/**
 * Handle /proxy tracking list
 */
async function handleTrackingList(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  const serverId = interaction.guildId!;

  // Defer reply since we'll be making API calls
  await interaction.deferReply();

  try {
    const proxies = ServerConfigManager.getProxyUsers(serverId);

    if (proxies.length === 0) {
      await interaction.followUp({
        content: '📋 **Proxy List**\n\nNo proxies are currently being tracked for this server.'
      });
      return;
    }

    // Fetch population data for the unique proxy countries (batched inside ScanService)
    const proxyCountryIds = [...new Set(proxies.map(p => p.proxyCountryId))];
    const countries = await new ScanService(apiService).getCountriesByIds(proxyCountryIds);
    const countryData = new Map(countries.map(c => [c._id, c]));

    // Calculate cooldowns and group by proxy country
    const now = new Date();
    const proxiesWithCooldown = proxies.map(proxy => {
      const lastChange = new Date(proxy.lastCitizenshipChangeAt);
      const cooldownEnd = new Date(lastChange.getTime() + (30 * 24 * 60 * 60 * 1000));
      const cooldownDays = Math.max(0, Math.ceil((cooldownEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
      
      const country = countryData.get(proxy.proxyCountryId);
      const population = country?.rankings?.countryActivePopulation?.value || 'Unknown';
      
      return {
        ...proxy,
        cooldownDays,
        population
      };
    });

    // Group by proxy country
    const groupedProxies = new Map<string, typeof proxiesWithCooldown>();
    for (const proxy of proxiesWithCooldown) {
      const key = proxy.proxyCountryId;
      if (!groupedProxies.has(key)) {
        groupedProxies.set(key, []);
      }
      groupedProxies.get(key)!.push(proxy);
    }

    // Build response message
    let message = '📋 **Proxy List**\n\n';
    
    for (const [, countryProxies] of groupedProxies) {
      const firstProxy = countryProxies[0];
      message += `**${firstProxy.proxyCountryName}** (Pop: ${firstProxy.population})\n`;
      
      for (const proxy of countryProxies) {
        const cooldownText = proxy.cooldownDays > 0 ? `${proxy.cooldownDays}d remaining` : '✅ Ready';
        const addedText = proxy.manuallyAdded ? '(Manual)' : '(Auto)';
        message += `  • **${proxy.username}** (${proxy.userId})\n`;
        message += `    ${proxy.originalCountryName} → ${proxy.proxyCountryName}\n`;
        message += `    Cooldown: ${cooldownText} | ${addedText}\n`;
      }
      message += '\n';
    }

    // Split message if too long
    const MAX_LENGTH = 2000;
    if (message.length > MAX_LENGTH) {
      const parts = [];
      let currentPart = '📋 **Proxy List**\n\n';
      
      for (const [, countryProxies] of groupedProxies) {
        const firstProxy = countryProxies[0];
        let countrySection = `**${firstProxy.proxyCountryName}** (Pop: ${firstProxy.population})\n`;
        
        for (const proxy of countryProxies) {
          const cooldownText = proxy.cooldownDays > 0 ? `${proxy.cooldownDays}d remaining` : '✅ Ready';
          const addedText = proxy.manuallyAdded ? '(Manual)' : '(Auto)';
          countrySection += `  • **${proxy.username}** (${proxy.userId})\n`;
          countrySection += `    ${proxy.originalCountryName} → ${proxy.proxyCountryName}\n`;
          countrySection += `    Cooldown: ${cooldownText} | ${addedText}\n`;
        }
        countrySection += '\n';
        
        if (currentPart.length + countrySection.length > MAX_LENGTH) {
          parts.push(currentPart);
          currentPart = countrySection;
        } else {
          currentPart += countrySection;
        }
      }
      
      if (currentPart.length > 0) {
        parts.push(currentPart);
      }
      
      // Send first part as followUp, rest as regular messages
      await interaction.followUp({ content: parts[0] });
      for (let i = 1; i < parts.length; i++) {
        await interaction.followUp({ content: parts[i] });
      }
    } else {
      await interaction.followUp({ content: message });
    }

  } catch (error) {
    logger.error('Error in proxy tracking list:', error);
    await interaction.followUp({
      content: 'An error occurred while fetching the proxy list.'
    });
  }
}

/**
 * Handle /proxy tracking add
 */
async function handleTrackingAdd(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  const userId = interaction.options.getString('userid', true);
  const originalCountryId = interaction.options.getString('originalcountryid', true);
  const serverId = interaction.guildId!;

  // Defer reply since we'll be making API calls
  await interaction.deferReply();

  try {
    const scan = new ScanService(apiService);

    // Fetch user data to get their current country
    const userData = await scan.getUserLite(userId);
    if (!userData) {
      await interaction.editReply({ content: `Could not fetch data for user \`${userId}\`.` });
      return;
    }

    // User's current country is the proxy country
    const proxyCountryId = userData.country;

    // Fetch country data for both countries
    const [originalCountryData, proxyCountryData] = await Promise.all([
      scan.getCountryById(originalCountryId),
      scan.getCountryById(proxyCountryId),
    ]);

    if (!originalCountryData || !proxyCountryData) {
      await interaction.editReply({ content: 'Could not fetch country data. Check the country IDs and try again.' });
      return;
    }

    // Check if user is already tracked
    const existingProxies = ServerConfigManager.getProxyUsers(serverId);
    const existingProxy = existingProxies.find(p => p.userId === userId);

    // Create proxy user object
    const proxyUser: ProxyUser = {
      userId,
      username: userData.username,
      originalCountryId,
      originalCountryName: originalCountryData.name,
      proxyCountryId,
      proxyCountryName: proxyCountryData.name,
      detectedAt: new Date().toISOString(),
      lastCitizenshipChangeAt: userData.dates.lastCitizenshipChangeAt,
      manuallyAdded: true
    };

    // Add to server configuration
    ServerConfigManager.addProxyUser(serverId, proxyUser);

    // Calculate cooldown
    const lastChange = new Date(proxyUser.lastCitizenshipChangeAt);
    const cooldownEnd = new Date(lastChange.getTime() + (30 * 24 * 60 * 60 * 1000));
    const now = new Date();
    const cooldownDays = Math.max(0, Math.ceil((cooldownEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
    const cooldownText = cooldownDays > 0 ? `${cooldownDays} days remaining` : 'Ready to move';

    let message = `✅ **Proxy user ${existingProxy ? 'updated' : 'added'}**\n\n`;
    message += `**User:** ${userData.username} (${userId})\n`;
    message += `**Movement:** ${originalCountryData.name} → ${proxyCountryData.name}\n`;
    message += `**Cooldown:** ${cooldownText}\n`;
    message += `**Added:** Manually\n`;

    await interaction.followUp({ content: message });

  } catch (error: any) {
    logger.error('Error in proxy tracking add:', error);
    
    let errorMessage = 'An error occurred while adding the proxy user.';
    if (error.response?.status === 404) {
      errorMessage = 'One of the specified IDs (user or original country) was not found. Please check the IDs and try again.';
    }
    
    await interaction.followUp({ content: errorMessage });
  }
}

/**
 * Handle /proxy tracking remove
 */
async function handleTrackingRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.options.getString('userid', true);
  const serverId = interaction.guildId!;

  try {
    const removed = ServerConfigManager.removeProxyUser(serverId, userId);

    if (removed) {
      await interaction.reply({
        content: `✅ **Proxy user removed**\n\nUser ID ${userId} has been removed from proxy tracking.`
      });
    } else {
      await interaction.reply({
        content: `❌ **User not found**\n\nUser ID ${userId} is not currently being tracked as a proxy.`
      });
    }
  } catch (error) {
    logger.error('Error in proxy tracking remove:', error);
    await interaction.reply({
      content: 'An error occurred while removing the proxy user.'
    });
  }
}

/**
 * Handle /proxy tracking status
 */
async function handleTrackingStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guildId!;

  try {
    const config = ServerConfigManager.getServerConfig(serverId);
    const proxyTracking = config?.proxyTracking;

    if (!proxyTracking) {
      await interaction.reply({
        content: '📊 **Proxy Tracking Status**\n\nProxy tracking is not configured for this server.'
      });
      return;
    }

    let message = '📊 **Proxy Tracking Status**\n\n';
    message += `**Global Status:** ${proxyTracking.enabled ? '✅ Enabled' : '❌ Disabled'}\n`;
    message += `**Tracked Countries:** ${proxyTracking.countries.length}\n`;
    message += `**Tracked Proxies:** ${proxyTracking.proxies.length}\n\n`;

    if (proxyTracking.countries.length > 0) {
      message += '**Tracked Countries:**\n';
      for (const country of proxyTracking.countries) {
        const statusIcon = country.enabled ? '✅' : '❌';
        const userCount = country.initialUsers ? country.initialUsers.length : 'Unknown';
        message += `  ${statusIcon} **${country.countryName}** (${userCount} users) → <#${country.channelId}>\n`;
      }
    }

    await interaction.reply({ content: message });

  } catch (error) {
    logger.error('Error in proxy tracking status:', error);
    await interaction.reply({
      content: 'An error occurred while fetching the proxy tracking status.'
    });
  }
}