import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
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
  data: createCommandBuilder('spectre', 'Military monitoring (border buildings, resistance, etc.)').addSubcommandGroup(group =>
    group
      .setName('monitor')
      .setDescription('Configure Spectre monitoring')
      .addSubcommand(sub =>
        sub
          .setName('buildings')
          .setDescription('Track base/bunker changes on border regions for a country')
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
          .setName('stop')
          .setDescription('Stop all Spectre monitoring for a country (buildings and resistance)')
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
            .setDescription('Border bunker/base snapshot from the latest poll')
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
        ? 'The border building monitor is on—wait for the next poll cycle to store a snapshot.'
        : 'Enable `/spectre monitor buildings` for this country and wait for a poll.';
      await interaction.editReply({
        content: `No border building snapshot stored for **${country.name}** (\`${country._id}\`). ${hint}`,
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
    const header = `**Border buildings snapshot** — **${country.name}** (\`${country._id}\`)\n_Last stored poll (in-memory)._`;
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
  const removedCountryId = ServerConfigManager.removeSpectreMonitorByCountry(interaction.guildId, raw);

  if (!removedCountryId) {
    await interaction.editReply({
      content: `No active Spectre monitor found for **${raw}** (buildings or resistance).`,
    });
    return;
  }

  clearAllCountrySnapshotsForSpectre(getSpectreSnapshotState(), interaction.guildId, removedCountryId);

  await interaction.editReply({
    content: `Stopped Spectre monitoring for **${raw}** (matched by name or id). In-memory snapshot for this country was cleared.`,
  });
  logger.info(`Spectre monitor removed: guild=${interaction.guildId} query=${raw}`);
}
