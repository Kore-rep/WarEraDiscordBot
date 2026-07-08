import { AttachmentBuilder, ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { DEFAULT_LEVEL_BRACKETS } from '../../config/config';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { parseLevelBrackets } from '../../services/leaderboard/leaderboardFormatter';
import {
  listAvailableWeeks,
  parseWeekEndingDate,
  readWeeklySnapshot,
} from '../../services/leaderboard/weeklyDamageSnapshotStore';

export const leaderboardCommand: Command = {
  data: createCommandBuilder(
    'leaderboard',
    'Manage hourly damage leaderboards for this server',
    { requireAdmin: false }
  )
    .addSubcommandGroup(group =>
      group
        .setName('config')
        .setDescription('Configure leaderboard settings')
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription('Set leaderboard configuration')
            .addStringOption(option =>
              option
                .setName('mus')
                .setDescription('Comma-separated military unit IDs (required on first setup)')
                .setRequired(false)
            )
            .addIntegerOption(option =>
              option
                .setName('topcount')
                .setDescription('Number of entries per leaderboard (default: 10)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(25)
            )
            .addStringOption(option =>
              option
                .setName('brackets')
                .setDescription('Level brackets, e.g. 20-29,30-39,40+ (default: 20-29,30-39,40+)')
                .setRequired(false)
            )
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('Channel for the living leaderboard message (defaults to this channel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('view')
            .setDescription('View current leaderboard settings')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable')
        .setDescription('Enable hourly leaderboard updates')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable hourly leaderboard updates')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('refresh')
        .setDescription('Refresh the leaderboards now')
    )
    .addSubcommandGroup(group =>
      group
        .setName('weekly')
        .setDescription('Weekly damage CSV snapshots')
        .addSubcommand(subcommand =>
          subcommand
            .setName('get')
            .setDescription('Download the weekly player and MU damage CSVs for a given week')
            .addStringOption(option =>
              option
                .setName('week')
                .setDescription('Week ending Sunday (YYYY-MM-DD), e.g. 2026-06-29')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List available weekly damage snapshot weeks')
        )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    discordService?: DiscordService,
    apiService?: ApiService
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a Discord server.',
          ephemeral: true,
        });
        return;
      }

      if (!apiService || !discordService) {
        await interaction.reply({
          content: 'Required services are not available.',
          ephemeral: true,
        });
        return;
      }

      const subcommandGroup = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      if (subcommandGroup === 'config' && subcommand === 'set') {
        await handleConfigSet(interaction, discordService);
      } else if (subcommandGroup === 'config' && subcommand === 'view') {
        await handleConfigView(interaction);
      } else if (subcommand === 'enable') {
        await handleEnable(interaction, apiService);
      } else if (subcommand === 'disable') {
        await handleDisable(interaction);
      } else if (subcommand === 'refresh') {
        await handleRefresh(interaction, apiService);
      } else if (subcommandGroup === 'weekly' && subcommand === 'get') {
        await handleWeeklyGet(interaction);
      } else if (subcommandGroup === 'weekly' && subcommand === 'list') {
        await handleWeeklyList(interaction);
      }
    } catch (error) {
      logger.error('Error in leaderboard command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};

async function handleConfigSet(
  interaction: ChatInputCommandInteraction,
  discordService: DiscordService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const musInput = interaction.options.getString('mus');
  const topCountOpt = interaction.options.getInteger('topcount');
  const bracketsInput = interaction.options.getString('brackets');
  const channel = interaction.options.getChannel('channel');

  const existing = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!existing && !musInput) {
    await interaction.reply({
      content: 'No configuration exists yet. Please specify **mus** (military unit IDs) on first setup.\n\nExample: `/leaderboard config set mus:abc123,def456`',
      ephemeral: true,
    });
    return;
  }

  if (channel && channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Please select a text channel for the leaderboard message.',
      ephemeral: true,
    });
    return;
  }

  const newChannelId =
    channel?.id ??
    existing?.channelId ??
    (interaction.channel?.isTextBased() ? interaction.channelId : undefined);

  if (!newChannelId) {
    await interaction.reply({
      content: 'Specify a **channel**, or run this command from a text channel.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  let militaryUnitIds = existing?.militaryUnitIds ?? [];
  if (musInput) {
    militaryUnitIds = musInput
      .split(',')
      .map(id => id.trim())
      .filter(Boolean);

    if (militaryUnitIds.length === 0) {
      await interaction.editReply({ content: 'Please provide at least one military unit ID.' });
      return;
    }
  }

  let levelBrackets = existing?.levelBrackets ?? DEFAULT_LEVEL_BRACKETS;
  if (bracketsInput) {
    try {
      levelBrackets = parseLevelBrackets(bracketsInput);
    } catch (error) {
      await interaction.editReply({
        content: error instanceof Error ? error.message : 'Invalid brackets format.',
      });
      return;
    }
  }

  const topCount = topCountOpt ?? existing?.topCount ?? 10;
  const channelChanged = existing?.channelId && existing.channelId !== newChannelId;

  ServerConfigManager.updateLeaderboardConfig(serverId, {
    channelId: newChannelId,
    militaryUnitIds,
    topCount,
    levelBrackets,
    enabled: existing?.enabled ?? true,
    messageId: channelChanged ? undefined : existing?.messageId,
    lastSnapshot: channelChanged ? undefined : existing?.lastSnapshot,
  });

  await discordService.initializeServerChannel(serverId, newChannelId);

  const bracketLabels = levelBrackets.map(b => b.label).join(', ');

  let message = '**Leaderboard configured**\n\n';
  message += `**Channel:** <#${newChannelId}>\n`;
  message += `**Military units:** ${militaryUnitIds.length} configured\n`;
  message += `**Top count:** ${topCount}\n`;
  message += `**Level brackets:** ${bracketLabels}\n`;
  message += `**Status:** ${existing?.enabled === false ? 'Disabled (use /leaderboard enable)' : 'Enabled'}`;

  if (channelChanged) {
    message += '\n\nChannel changed — a new living message will be posted on the next refresh.';
  }

  await interaction.editReply({ content: message });
}

async function handleConfigView(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!config) {
    await interaction.reply({
      content: 'Leaderboards are not configured for this server.\n\nUse `/leaderboard config set` to get started.',
      ephemeral: true,
    });
    return;
  }

  const status = config.enabled !== false ? 'Enabled' : 'Disabled';
  const bracketLabels = config.levelBrackets.map(b => b.label).join(', ');
  const lastUpdated = config.lastUpdated
    ? `<t:${Math.floor(new Date(config.lastUpdated).getTime() / 1000)}:R>`
    : 'Never';

  await interaction.reply({
    content:
      '**Leaderboard Settings**\n\n' +
      `**Channel:** <#${config.channelId}>\n` +
      `**Military unit IDs:** ${config.militaryUnitIds.join(', ') || 'None'}\n` +
      `**Top count:** ${config.topCount}\n` +
      `**Level brackets:** ${bracketLabels}\n` +
      `**Status:** ${status}\n` +
      `**Last updated:** ${lastUpdated}`,
    ephemeral: true,
  });
}

async function handleEnable(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!config) {
    await interaction.reply({
      content: 'Leaderboards are not configured for this server.\n\nUse `/leaderboard config set` first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  ServerConfigManager.updateLeaderboardConfig(serverId, {
    ...config,
    enabled: true,
  });

  const leaderboardService = apiService.getLeaderboardService();
  if (leaderboardService) {
    try {
      await leaderboardService.refreshServer(serverId);
      await interaction.editReply({
        content: '**Leaderboards enabled.** The living message has been refreshed.',
      });
      return;
    } catch (error) {
      logger.error('Failed to refresh leaderboard on enable', error);
      await interaction.editReply({
        content: '**Leaderboards enabled**, but the initial refresh failed. Check logs and try again later.',
      });
      return;
    }
  }

  await interaction.editReply({
    content: '**Leaderboards enabled** for this server.',
  });
}

async function handleDisable(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!config) {
    await interaction.reply({
      content: 'Leaderboards are not configured for this server.',
      ephemeral: true,
    });
    return;
  }

  ServerConfigManager.updateLeaderboardConfig(serverId, {
    ...config,
    enabled: false,
  });

  await interaction.reply({
    content: '**Leaderboards disabled** for this server. The last message will remain in place.',
    ephemeral: true,
  });
}

async function handleWeeklyGet(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!config) {
    await interaction.reply({
      content: 'Leaderboards are not configured for this server.\n\nUse `/leaderboard config set` first.',
      ephemeral: true,
    });
    return;
  }

  const weekInput = interaction.options.getString('week', true);
  if (!parseWeekEndingDate(weekInput)) {
    await interaction.reply({
      content: 'Invalid week format. Use the Sunday date for that week as **YYYY-MM-DD** (e.g. `2026-06-29`).',
      ephemeral: true,
    });
    return;
  }

  const userCsv = await readWeeklySnapshot(serverId, 'users', weekInput);
  const muCsv = await readWeeklySnapshot(serverId, 'mu', weekInput);
  if (!userCsv && !muCsv) {
    const available = await listAvailableWeeks(serverId);
    let message = `No weekly damage snapshot found for week ending **${weekInput}**.`;
    if (available.length > 0) {
      message += `\n\nAvailable weeks:\n${available.map(week => `• ${week}`).join('\n')}`;
    } else {
      message += '\n\nNo snapshots have been saved yet. Snapshots are updated hourly with the leaderboard.';
    }
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  const files = [];
  if (userCsv) {
    files.push(
      new AttachmentBuilder(Buffer.from(userCsv, 'utf-8'), {
        name: `weekly-damage-users-${weekInput}.csv`,
      })
    );
  }
  if (muCsv) {
    files.push(
      new AttachmentBuilder(Buffer.from(muCsv, 'utf-8'), {
        name: `weekly-damage-mu-${weekInput}.csv`,
      })
    );
  }

  const parts = [];
  if (userCsv) parts.push('player');
  if (muCsv) parts.push('military unit');

  await interaction.reply({
    content: `Weekly damage snapshots for week ending **${weekInput}** (${parts.join(' + ')}).`,
    files,
    ephemeral: true,
  });
}

async function handleWeeklyList(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!config) {
    await interaction.reply({
      content: 'Leaderboards are not configured for this server.\n\nUse `/leaderboard config set` first.',
      ephemeral: true,
    });
    return;
  }

  const available = await listAvailableWeeks(serverId);
  if (available.length === 0) {
    await interaction.reply({
      content: 'No weekly damage snapshots are available yet. Snapshots are updated hourly with the leaderboard.',
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    content:
      '**Available weekly damage snapshots** (week ending Sunday):\n\n' +
      available
        .map(
          week =>
            `• \`${week}\` — use \`/leaderboard weekly get week:${week}\` (player + MU CSVs)`
        )
        .join('\n'),
    ephemeral: true,
  });
}

async function handleRefresh(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;

  if (!config) {
    await interaction.reply({
      content: 'Leaderboards are not configured for this server.\n\nUse `/leaderboard config set` first.',
      ephemeral: true,
    });
    return;
  }

  const leaderboardService = apiService.getLeaderboardService();
  if (!leaderboardService) {
    await interaction.reply({
      content: 'Leaderboard service is not available.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    await leaderboardService.refreshServer(serverId);
    await interaction.editReply({
      content: `**Leaderboards refreshed.** Updated <#${config.channelId}>.`,
    });
  } catch (error) {
    logger.error('Failed to refresh leaderboard on demand', error);
    await interaction.editReply({
      content: 'Failed to refresh leaderboards. Check logs and try again.',
    });
  }
}
