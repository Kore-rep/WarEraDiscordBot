import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { TrackedCountry } from '../../config/config';
import { logger } from '../../utils/logger';
import { ApiService } from '../../services/api/ApiService';
import type { APIClient } from 'warera-sdk';
import { GetAllCountriesResponse } from 'warera-sdk';
import {
  getSpectreSnapshotState,
  clearAllCountrySnapshotsForSpectre,
  getCountrySnapshots,
  getResistanceCountrySnapshots,
} from '../../utils/spectreBuildingStateStore';
import { chunkLines, formatBuildingSnapshotLines } from '../../services/spectre/spectreBuildingLogic';
import { formatResistanceSnapshotLines } from '../../services/spectre/spectreResistanceLogic';

type GetRegionsObjectResponse = Awaited<
  ReturnType<APIClient['region']['getRegionsObject']>
>;
type RegionDTO = GetRegionsObjectResponse['result']['data'][string];

function resolveCountryByName(
  countries: GetAllCountriesResponse['result']['data'],
  input: string
): { country: GetAllCountriesResponse['result']['data'][number] } | { error: string } {
  const needle = input.trim().toLowerCase();
  const matches = countries.filter(c => c.name.toLowerCase() === needle);
  if (matches.length === 0) {
    return { error: `No country found with name **${input.trim()}**. Check spelling (exact name, case-insensitive).` };
  }
  if (matches.length > 1) {
    return {
      error: `Multiple countries match **${input.trim()}**. Please use a more specific name.`,
    };
  }
  return { country: matches[0] };
}

function hasEnabledSpectreMonitor(
  serverId: string,
  countryId: string,
  kind: 'buildings' | 'resistance'
): boolean {
  const cfg = ServerConfigManager.getServerConfig(serverId);
  const list =
    kind === 'buildings' ? cfg?.spectre?.buildingMonitors : cfg?.spectre?.resistanceMonitors;
  return (list || []).some(m => m.countryId === countryId && m.enabled !== false);
}

async function fetchRegionsMap(apiService: ApiService): Promise<Map<string, RegionDTO>> {
  const batch = apiService.getBatchClient();
  const regionsPromise = batch.region.getRegionsObject({
    cache: { ttl: 86400 * 1000 },
  });
  await batch.runBatch();
  const regionsResponse = (await regionsPromise) as GetRegionsObjectResponse;
  const map = new Map<string, RegionDTO>();
  for (const [id, r] of Object.entries(regionsResponse.result.data)) {
    map.set(id, r);
  }
  return map;
}

function resolveAlertChannel(
  interaction: ChatInputCommandInteraction,
  channelOpt: ReturnType<ChatInputCommandInteraction['options']['getChannel']>
): { channelId: string } | { error: string } {
  if (channelOpt) {
    if (channelOpt.type !== ChannelType.GuildText) {
      return { error: 'Please choose a text channel.' };
    }
    return { channelId: channelOpt.id };
  }
  if (!interaction.channel || !interaction.channel.isTextBased()) {
    return {
      error: 'Specify a **channel**, or run this command from a text channel.',
    };
  }
  return { channelId: interaction.channelId };
}

export const spectreCommand: Command = {
  data: createCommandBuilder('spectre', 'Military monitoring (border buildings, resistance, etc.)', {
    requireAdmin: false,
  }).addSubcommandGroup(group =>
    group
      .setName('monitor')
      .setDescription('Configure Spectre monitoring')
      .addSubcommand(sub =>
        sub
          .setName('buildings')
          .setDescription(
            'Bunker/base changes in foreign regions bordering the monitored country.'
          )
          .addStringOption(opt =>
            opt.setName('country').setDescription('Exact country name').setRequired(true)
          )
          .addChannelOption(opt =>
            opt
              .setName('channel')
              .setDescription('Channel for alerts (defaults to this channel)')
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('resistance')
          .setDescription(
            'Alert on 90%+ resistance or >10% ratio change between polls (per region)'
          )
          .addStringOption(opt =>
            opt.setName('country').setDescription('Exact country name').setRequired(true)
          )
          .addChannelOption(opt =>
            opt
              .setName('channel')
              .setDescription('Channel for alerts (defaults to this channel)')
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('population')
          .setDescription('Monitor country population levels')
          .addStringOption(opt =>
            opt.setName('country').setDescription('Exact country name').setRequired(true)
          )
          .addIntegerOption(opt =>
            opt
              .setName('warnthreshold')
              .setDescription('Population warn threshold (one-time alert)')
              .setRequired(true)
              .setMinValue(1)
              .setMaxValue(100)
          )
          .addIntegerOption(opt =>
            opt
              .setName('criticalthreshold')
              .setDescription('Population critical threshold (repeated alerts)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(50)
          )
          .addChannelOption(opt =>
            opt
              .setName('channel')
              .setDescription('Channel for alerts (defaults to this channel)')
              .setRequired(false)
              .addChannelTypes(ChannelType.GuildText)
          )
          .addStringOption(opt =>
            opt
              .setName('mentions')
              .setDescription('Users/roles to mention (separate with spaces, e.g., @user1 @role1)')
              .setRequired(false)
          )
      )
      .addSubcommand(sub =>
        sub
          .setName('stop')
          .setDescription('Stop all Spectre monitoring for a country (buildings, resistance, population)')
          .addStringOption(opt =>
            opt.setName('country').setDescription('Country name or id').setRequired(true)
          )
      )
  )
    .addSubcommandGroup(group =>
      group
        .setName('snapshot')
        .setDescription('Show last polled Spectre data stored in memory')
        .addSubcommand(sub =>
          sub
            .setName('buildings')
            .setDescription('Bunker/base snapshot for foreign regions neighboring this country (latest poll)')
            .addStringOption(opt =>
              opt.setName('country').setDescription('Exact country name').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('resistance')
            .setDescription('Resistance snapshot from the latest poll')
            .addStringOption(opt =>
              opt.setName('country').setDescription('Exact country name').setRequired(true)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('population')
            .setDescription('List all tracked countries for population monitoring')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction, _discordService?: unknown, apiService?: ApiService): Promise<void> {
    const group = interaction.options.getSubcommandGroup();
    const sub = interaction.options.getSubcommand();

    if (!apiService) {
      await interaction.reply({ content: 'This command must be used in a server with API access.', ephemeral: true });
      return;
    }

    if (group === 'monitor') {
      if (sub === 'buildings') {
        await handleMonitorBuildings(interaction, apiService);
        return;
      }
      if (sub === 'resistance') {
        await handleMonitorResistance(interaction, apiService);
        return;
      }
      if (sub === 'population') {
        await handleMonitorPopulation(interaction, apiService);
        return;
      }
      if (sub === 'stop') {
        await handleMonitorStop(interaction);
        return;
      }
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
      return;
    }

    if (group === 'snapshot') {
      if (sub === 'buildings') {
        await handleSnapshotBuildings(interaction, apiService);
        return;
      }
      if (sub === 'resistance') {
        await handleSnapshotResistance(interaction, apiService);
        return;
      }
      if (sub === 'population') {
        await handleSnapshotPopulation(interaction);
        return;
      }
      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
      return;
    }

    await interaction.reply({ content: 'Unknown command group.', ephemeral: true });
  },
};

async function handleMonitorBuildings(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const countryInput = interaction.options.getString('country', true);
  const channelOpt = interaction.options.getChannel('channel', false);
  const ch = resolveAlertChannel(interaction, channelOpt);
  if ('error' in ch) {
    await interaction.editReply({ content: ch.error });
    return;
  }

  try {
    const api = apiService.getClient();
    const res = (await api.country.getAllCountries({
      cache: { ttl: 60 * 60 * 1000 },
    })) as GetAllCountriesResponse;
    const resolved = resolveCountryByName(res.result.data, countryInput);
    if ('error' in resolved) {
      await interaction.editReply({ content: resolved.error });
      return;
    }

    const { country } = resolved;
    ServerConfigManager.upsertSpectreBuildingMonitor(interaction.guildId, {
      countryId: country._id,
      countryName: country.name,
      channelId: ch.channelId,
      enabled: true,
    });

    await interaction.editReply({
      content:
        `Border building monitor **enabled** for **${country.name}** (\`${country._id}\`).\n` +
        `Alerts will go to <#${ch.channelId}> on the same schedule as bounty polling.\n` +
        `The first poll stores a baseline (no message). Changes are reported in **S.P.E.C.T.R.E reports** after that.\n\n` +
        `Use \`/spectre monitor stop\` to turn this off.`,
    });

    logger.info(
      `Spectre buildings monitor set: guild=${interaction.guildId} country=${country._id} channel=${ch.channelId}`
    );
  } catch (error) {
    logger.error('spectre monitor buildings failed', error);
    await interaction.editReply({ content: 'Failed to configure monitor. Check logs.' });
  }
}

async function handleMonitorResistance(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const countryInput = interaction.options.getString('country', true);
  const channelOpt = interaction.options.getChannel('channel', false);
  const ch = resolveAlertChannel(interaction, channelOpt);
  if ('error' in ch) {
    await interaction.editReply({ content: ch.error });
    return;
  }

  try {
    const api = apiService.getClient();
    const res = (await api.country.getAllCountries({
      cache: { ttl: 60 * 60 * 1000 },
    })) as GetAllCountriesResponse;
    const resolved = resolveCountryByName(res.result.data, countryInput);
    if ('error' in resolved) {
      await interaction.editReply({ content: resolved.error });
      return;
    }

    const { country } = resolved;
    ServerConfigManager.upsertSpectreResistanceMonitor(interaction.guildId, {
      countryId: country._id,
      countryName: country.name,
      channelId: ch.channelId,
      enabled: true,
    });

    await interaction.editReply({
      content:
        `Resistance monitor **enabled** for **${country.name}** (\`${country._id}\`).\n` +
        `You will be notified when any region reaches **90%** or more of max resistance (and on changes while above 90%), or when resistance **ratio moves more than 10%** between polls.\n` +
        `Alerts go to <#${ch.channelId}> with other Spectre reports (**S.P.E.C.T.R.E reports:**).\n` +
        `The first poll stores a baseline (no message).\n\n` +
        `Use \`/spectre monitor stop\` to turn this off.`,
    });

    logger.info(
      `Spectre resistance monitor set: guild=${interaction.guildId} country=${country._id} channel=${ch.channelId}`
    );
  } catch (error) {
    logger.error('spectre monitor resistance failed', error);
    await interaction.editReply({ content: 'Failed to configure monitor. Check logs.' });
  }
}

async function handleSnapshotBuildings(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const countryInput = interaction.options.getString('country', true);
  const guildId = interaction.guildId;

  try {
    const api = apiService.getClient();
    const res = (await api.country.getAllCountries({
      cache: { ttl: 60 * 60 * 1000 },
    })) as GetAllCountriesResponse;
    const resolved = resolveCountryByName(res.result.data, countryInput);
    if ('error' in resolved) {
      await interaction.editReply({ content: resolved.error });
      return;
    }

    const { country } = resolved;
    const state = getSpectreSnapshotState();
    const snaps = getCountrySnapshots(state, guildId, country._id);
    const monitored = hasEnabledSpectreMonitor(guildId, country._id, 'buildings');

    if (Object.keys(snaps).length === 0) {
      const hint = monitored
        ? 'The neighbor-region building monitor is on—wait for the next poll cycle to store a snapshot.'
        : 'Enable `/spectre monitor buildings` for this country and wait for a poll.';
      await interaction.editReply({
        content: `No building snapshot for foreign regions neighboring **${country.name}** (\`${country._id}\`). ${hint}`,
      });
      return;
    }

    const regions = await fetchRegionsMap(apiService);
    const regionNames = new Map<string, string>();
    for (const rid of Object.keys(snaps)) {
      const r = regions.get(rid);
      regionNames.set(rid, r?.name || rid);
    }

    const lines = formatBuildingSnapshotLines(snaps, regionNames);
    const header = `**Neighbor-region buildings snapshot** — **${country.name}** (\`${country._id}\`)\n_Foreign regions adjacent to this country; last stored poll (in-memory)._`;
    const chunks = chunkLines([header, '', ...lines]);

    await interaction.editReply({ content: chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral: true });
    }
  } catch (error) {
    logger.error('spectre snapshot buildings failed', error);
    await interaction.editReply({ content: 'Failed to load snapshot. Check logs.' });
  }
}

async function handleSnapshotResistance(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const countryInput = interaction.options.getString('country', true);
  const guildId = interaction.guildId;

  try {
    const api = apiService.getClient();
    const res = (await api.country.getAllCountries({
      cache: { ttl: 60 * 60 * 1000 },
    })) as GetAllCountriesResponse;
    const resolved = resolveCountryByName(res.result.data, countryInput);
    if ('error' in resolved) {
      await interaction.editReply({ content: resolved.error });
      return;
    }

    const { country } = resolved;
    const state = getSpectreSnapshotState();
    const snaps = getResistanceCountrySnapshots(state, guildId, country._id);
    const monitored = hasEnabledSpectreMonitor(guildId, country._id, 'resistance');

    if (Object.keys(snaps).length === 0) {
      const hint = monitored
        ? 'The resistance monitor is on—wait for the next poll cycle to store a snapshot.'
        : 'Enable `/spectre monitor resistance` for this country and wait for a poll.';
      await interaction.editReply({
        content: `No resistance snapshot stored for **${country.name}** (\`${country._id}\`). ${hint}`,
      });
      return;
    }

    const regions = await fetchRegionsMap(apiService);
    const regionNames = new Map<string, string>();
    for (const rid of Object.keys(snaps)) {
      const r = regions.get(rid);
      regionNames.set(rid, r?.name || rid);
    }

    const lines = formatResistanceSnapshotLines(snaps, regionNames);
    const header = `**Resistance snapshot** — **${country.name}** (\`${country._id}\`)\n_Last stored poll (in-memory)._`;
    const chunks = chunkLines([header, '', ...lines]);

    await interaction.editReply({ content: chunks[0] });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral: true });
    }
  } catch (error) {
    logger.error('spectre snapshot resistance failed', error);
    await interaction.editReply({ content: 'Failed to load snapshot. Check logs.' });
  }
}

async function handleMonitorStop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this command in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const raw = interaction.options.getString('country', true).trim();
  
  // Remove Spectre monitors (buildings/resistance)
  const removedCountryId = ServerConfigManager.removeSpectreMonitorByCountry(interaction.guildId, raw);
  
  // Also try to remove population monitoring for the same country
  let removedPopulation = false;
  try {
    const countries = ServerConfigManager.getTrackedCountries(interaction.guildId);
    const countryToRemove = countries.find(c => 
      c.countryId === raw || c.countryName.toLowerCase() === raw.toLowerCase()
    );
    
    if (countryToRemove) {
      removedPopulation = ServerConfigManager.removeTrackedCountry(interaction.guildId, countryToRemove.countryId);
    }
  } catch (error) {
    logger.warn('Error removing population tracking in stop command:', error);
  }

  if (!removedCountryId && !removedPopulation) {
    await interaction.editReply({
      content: `No active Spectre monitor found for **${raw}** (buildings, resistance, or population).`,
    });
    return;
  }

  if (removedCountryId) {
    clearAllCountrySnapshotsForSpectre(getSpectreSnapshotState(), interaction.guildId, removedCountryId);
  }

  const stoppedTypes = [];
  if (removedCountryId) stoppedTypes.push('buildings/resistance');
  if (removedPopulation) stoppedTypes.push('population');

  await interaction.editReply({
    content: `Stopped Spectre monitoring for **${raw}** (${stoppedTypes.join(' and ')}). In-memory snapshot for this country was cleared.`,
  });
  logger.info(`Spectre monitor removed: guild=${interaction.guildId} query=${raw} types=${stoppedTypes.join(',')}`);
}

async function handleMonitorPopulation(interaction: ChatInputCommandInteraction, apiService: ApiService): Promise<void> {
  const countryName = interaction.options.getString('country', true);
  const channel = interaction.options.getChannel('channel');
  const warnThreshold = interaction.options.getInteger('warnthreshold', true);
  const criticalThreshold = interaction.options.getInteger('criticalthreshold', true);
  const mentionsString = interaction.options.getString('mentions');
  const serverId = interaction.guildId!;

  // Validate thresholds
  if (criticalThreshold >= warnThreshold) {
    await interaction.reply({
      content: 'Critical threshold must be less than warn threshold.',
      ephemeral: true
    });
    return;
  }

  // Resolve channel
  const channelResult = resolveAlertChannel(interaction, channel);
  if ('error' in channelResult) {
    await interaction.reply({ content: channelResult.error, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  try {
    // Fetch all countries to resolve the name
    const apiClient = apiService.getClient();
    const countriesResponse = await apiClient.country.getAllCountries();
    const countries = countriesResponse.result.data;

    const countryResult = resolveCountryByName(countries, countryName);
    if ('error' in countryResult) {
      await interaction.followUp({ content: countryResult.error });
      return;
    }

    const country = countryResult.country;
    
    // Parse mention IDs
    let mentionIds: string[] | undefined;
    if (mentionsString) {
      const mentionMatches = mentionsString.matchAll(/<@[!&]?\d+>/g);
      mentionIds = Array.from(mentionMatches).map(match => match[0]);
      
      if (mentionIds.length === 0) {
        await interaction.followUp({
          content: 'Invalid mention format. Please use proper Discord mentions like @user or @role.',
        });
        return;
      }
    }

    // Check if country is already being tracked
    const existingCountries = ServerConfigManager.getTrackedCountries(serverId);
    const existingCountry = existingCountries.find(c => c.countryId === country._id);
    
    if (existingCountry) {
      await interaction.followUp({
        content: `**${country.name}** is already being tracked. Use \`/spectre snapshot population\` to view tracked countries or remove it first.`,
      });
      return;
    }

    // Get current population
    const countryResponse = await apiClient.country.getCountryById(country._id);
    const currentPopulation = countryResponse.result.data.rankings?.countryActivePopulation?.value || 0;

    // Create tracked country object
    const trackedCountry: TrackedCountry = {
      countryId: country._id,
      countryName: country.name,
      channelId: channelResult.channelId,
      populationWarnThreshold: warnThreshold,
      populationCriticalThreshold: criticalThreshold,
      mentionIds,
    };

    // Add to server configuration
    ServerConfigManager.addTrackedCountry(serverId, trackedCountry);

    let message = `✅ **Population tracking enabled** for **${country.name}**\n\n`;
    message += `**Channel:** <#${channelResult.channelId}>\n`;
    message += `**Warn threshold:** ${warnThreshold}\n`;
    message += `**Critical threshold:** ${criticalThreshold}\n`;
    message += `**Current population:** ${currentPopulation}\n`;

    if (mentionIds && mentionIds.length > 0) {
      message += `**Mentions:** ${mentionIds.join(' ')}\n`;
    }

    await interaction.followUp({ content: message });

    // Send immediate alert if already below threshold
    if (currentPopulation <= criticalThreshold || currentPopulation <= warnThreshold) {
      await sendImmediatePopulationAlert(interaction, trackedCountry, currentPopulation, apiService);
    }

  } catch (error: any) {
    logger.error('Error in population monitoring setup:', error);
    
    let errorMessage = 'An error occurred while setting up population monitoring.';
    if (error.response?.status === 404) {
      errorMessage = `Country "${countryName}" not found. Please check the country name and try again.`;
    }
    
    await interaction.followUp({ content: errorMessage });
  }
}

async function handleSnapshotPopulation(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guildId!;
  const trackedCountries = ServerConfigManager.getTrackedCountries(serverId);

  if (trackedCountries.length === 0) {
    await interaction.reply({
      content: 'No countries are currently being tracked for population.\n\nUse `/spectre monitor population` to start tracking a country.',
    });
    return;
  }

  // Build list message
  let message = '**Tracked Countries (Population)**\n\n';
  
  for (const country of trackedCountries) {
    message += `**${country.countryName}** (\`${country.countryId}\`)\n`;
    message += `- Channel: <#${country.channelId}>\n`;
    message += `- Warn threshold: ${country.populationWarnThreshold}\n`;
    message += `- Critical threshold: ${country.populationCriticalThreshold}\n`;
    
    if (country.mentionIds && country.mentionIds.length > 0) {
      // Escape mentions to prevent actual mentions in the snapshot
      const mentions = country.mentionIds.map(mention => `\`${mention}\``).join(' ');
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

  // Split message if too long
  const MAX_LENGTH = 2000;
  if (message.length > MAX_LENGTH) {
    const parts = [];
    let currentPart = '**Tracked Countries (Population)**\n\n';
    
    for (const country of trackedCountries) {
      let countrySection = `**${country.countryName}** (\`${country.countryId}\`)\n`;
      countrySection += `- Channel: <#${country.channelId}>\n`;
      countrySection += `- Warn threshold: ${country.populationWarnThreshold}\n`;
      countrySection += `- Critical threshold: ${country.populationCriticalThreshold}\n`;
      
      if (country.mentionIds && country.mentionIds.length > 0) {
        // Escape mentions to prevent actual mentions in the snapshot
        const mentions = country.mentionIds.map(mention => `\`${mention}\``).join(' ');
        countrySection += `- Mentions: ${mentions}\n`;
      }
      
      if (country.lastChecked) {
        const lastCheckedDate = new Date(country.lastChecked);
        countrySection += `- Last checked: <t:${Math.floor(lastCheckedDate.getTime() / 1000)}:R>\n`;
      }
      
      if (country.lastPopulation !== undefined) {
        countrySection += `- Current population: ${country.lastPopulation}`;
        
        if (country.lastPopulation < country.populationCriticalThreshold) {
          countrySection += ` 🚨 **CRITICAL**`;
        } else if (country.lastPopulation < country.populationWarnThreshold) {
          if (country.warnReported) {
            countrySection += ` ⚠️ **LOW** (reported)`;
          } else {
            countrySection += ` ⚠️ **LOW**`;
          }
        } else {
          countrySection += ` ✅`;
        }
        countrySection += '\n';
      } else {
        countrySection += `- Current population: Never checked\n`;
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
    
    // Send first part as reply, rest as follow-up messages
    await interaction.reply({ content: parts[0] });
    for (let i = 1; i < parts.length; i++) {
      await interaction.followUp({ content: parts[i] });
    }
  } else {
    await interaction.reply({
      content: message,
    });
  }
}

async function sendImmediatePopulationAlert(
  interaction: ChatInputCommandInteraction, 
  trackedCountry: TrackedCountry, 
  currentPopulation: number, 
  apiService: ApiService
): Promise<void> {
  try {
    const alertType = currentPopulation <= trackedCountry.populationCriticalThreshold ? 'critical' : 'warn';
    
    let message = `🚨 **${alertType.toUpperCase()} POPULATION ALERT**\n\n`;
    message += `**Country:** ${trackedCountry.countryName}\n`;
    message += `**Current Population:** ${currentPopulation}\n`;
    
    if (alertType === 'critical') {
      message += `**Critical Threshold:** ${trackedCountry.populationCriticalThreshold}\n`;
      message += `\n⚠️ This country is at **critical population levels** and may be vulnerable to takeover!`;
    } else {
      message += `**Warning Threshold:** ${trackedCountry.populationWarnThreshold}\n`;
      message += `\n⚠️ This country has **low population** - monitoring for critical levels.`;
    }

    // Add government members info for warn alerts
    if (alertType === 'warn') {
      try {
        const apiClient = apiService.getClient();
        const govResponse = await apiClient.government.getByCountryId(trackedCountry.countryId);
        const government = govResponse.result.data;
        
        const playerIds = new Set<string>();
        
        // Add all government members
        if (government.president) playerIds.add(government.president);
        if (government.vicePresident) playerIds.add(government.vicePresident);
        if (government.minOfDefense) playerIds.add(government.minOfDefense);
        if (government.minOfForeignAffairs) playerIds.add(government.minOfForeignAffairs);
        if (government.minOfEconomy) playerIds.add(government.minOfEconomy);
        if (government.congressMembers && Array.isArray(government.congressMembers)) {
          government.congressMembers.forEach(id => playerIds.add(id));
        }

        if (playerIds.size > 0) {
          const batchClient = apiService.createCommandBatchClient();
          const playerIdArray = Array.from(playerIds);
          const userPromises = playerIdArray.map(id => 
            batchClient.user.getUserLite(id)
          );
          
          await batchClient.runBatch();
          const userResults = await Promise.all(userPromises);
          
          const playersInfo = [];
          for (let i = 0; i < playerIdArray.length; i++) {
            const userResponse = userResults[i];
            if (userResponse?.result?.data) {
              const userData = userResponse.result.data;
              playersInfo.push({
                username: userData.username,
                lastLogin: userData.dates.lastConnectionAt
              });
            }
          }
          
          if (playersInfo.length > 0) {
            playersInfo.sort((a, b) => new Date(b.lastLogin).getTime() - new Date(a.lastLogin).getTime());
            
            message += `\n\n**Government Members:**\n`;
            for (const player of playersInfo.slice(0, 5)) {
              const lastLoginDate = new Date(player.lastLogin);
              message += `- **${player.username}**: <t:${Math.floor(lastLoginDate.getTime() / 1000)}:R>\n`;
            }
            
            if (playersInfo.length > 5) {
              message += `... and ${playersInfo.length - 5} more`;
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to fetch government info for immediate alert:', error);
      }
    }

    // Add mentions if configured
    if (trackedCountry.mentionIds && trackedCountry.mentionIds.length > 0) {
      message += `\n\n${trackedCountry.mentionIds.join(' ')}`;
    }

    // Send to the configured channel (not the interaction channel)
    const discordService = interaction.client as any; // We don't have DiscordService here, use client directly
    const channel = await discordService.channels.fetch(trackedCountry.channelId);
    if (channel?.isTextBased()) {
      await channel.send(message);
    }

    await interaction.followUp({
      content: `📢 Sent immediate ${alertType} population alert to <#${trackedCountry.channelId}>`,
      ephemeral: true
    });

  } catch (error) {
    logger.error('Error sending immediate population alert:', error);
  }
}
