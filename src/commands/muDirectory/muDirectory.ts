import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { canManageFeature, hasManageRoles, replyUnauthorized } from '../../utils/commandAuth';
import { parseMuInput } from '../../services/muDirectory/muLink';
import { COMMAND_HELP } from '../help/helpTexts';

const MANAGE_ROLE_OPTIONS = ['role1', 'role2', 'role3', 'role4', 'role5'] as const;

export const muDirectoryCommand: Command = {
  data: createCommandBuilder(
    'mudirectory',
    'Maintain a WarEra Military-Unit directory in a channel',
    { requireAdmin: false }
  )
    .addSubcommandGroup(group =>
      group
        .setName('config')
        .setDescription('Configure the MU directory')
        .addSubcommand(sub => {
          sub
            .setName('set')
            .setDescription('Set MU directory configuration (requires Manage Roles)')
            .addStringOption(opt =>
              opt
                .setName('mus')
                .setDescription('Comma-separated MU ids or links (required on first setup)')
                .setRequired(false)
            )
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel for the living directory (defaults to this channel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
            );
          for (const name of MANAGE_ROLE_OPTIONS) {
            sub.addRoleOption(opt =>
              opt
                .setName(name)
                .setDescription('Role allowed to manage the directory (set any to replace the list)')
                .setRequired(false)
            );
          }
          return sub;
        })
        .addSubcommand(sub =>
          sub.setName('view').setDescription('View current MU directory settings')
        )
    )
    .addSubcommand(sub =>
      sub.setName('enable').setDescription('Enable daily directory updates (requires Manage Roles)')
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable daily directory updates (requires Manage Roles)')
    )
    .addSubcommand(sub =>
      sub.setName('refresh').setDescription('Refresh the directory now')
    )
    .addSubcommand(sub =>
      sub.setName('help').setDescription('How the MU directory works')
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
        await interaction.reply({ content: 'Required services are not available.', ephemeral: true });
        return;
      }

      const group = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      if (group === 'config' && subcommand === 'set') {
        await handleConfigSet(interaction, discordService);
      } else if (group === 'config' && subcommand === 'view') {
        await handleConfigView(interaction);
      } else if (subcommand === 'enable') {
        await handleEnable(interaction, apiService);
      } else if (subcommand === 'disable') {
        await handleDisable(interaction);
      } else if (subcommand === 'refresh') {
        await handleRefresh(interaction, apiService);
      } else if (subcommand === 'help') {
        await interaction.reply({ content: COMMAND_HELP.mudirectory, ephemeral: true });
      } else {
        await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
      }
    } catch (error) {
      logger.error('Error in mudirectory command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};

/** Parse the `mus` option (comma-separated ids or links) into a deduped id list. */
function parseMuIds(raw: string): { ids: string[]; invalid: string[] } {
  const ids: string[] = [];
  const invalid: string[] = [];
  for (const token of raw.split(',').map(t => t.trim()).filter(Boolean)) {
    try {
      const { id } = parseMuInput(token);
      if (!ids.includes(id)) {
        ids.push(id);
      }
    } catch {
      invalid.push(token);
    }
  }
  return { ids, invalid };
}

/** Read the manage-role options (role1..role5); returns undefined if none were given. */
function readManageRoles(interaction: ChatInputCommandInteraction): string[] | undefined {
  const roleIds: string[] = [];
  for (const name of MANAGE_ROLE_OPTIONS) {
    const role = interaction.options.getRole(name);
    if (role && !roleIds.includes(role.id)) {
      roleIds.push(role.id);
    }
  }
  return roleIds.length > 0 ? roleIds : undefined;
}

async function handleConfigSet(
  interaction: ChatInputCommandInteraction,
  discordService: DiscordService
): Promise<void> {
  if (!hasManageRoles(interaction)) {
    await replyUnauthorized(interaction, 'You need the Manage Roles permission to configure the MU directory.');
    return;
  }

  const serverId = interaction.guild!.id;
  const musInput = interaction.options.getString('mus');
  const channel = interaction.options.getChannel('channel');
  const manageRoleIds = readManageRoles(interaction);

  const existing = ServerConfigManager.getMuDirectoryConfig(serverId);

  if (!existing && !musInput) {
    await interaction.reply({
      content:
        'No configuration exists yet. Provide **mus** (MU ids or links) on first setup.\n\n' +
        'Example: `/mudirectory config set mus:abc123,https://app.warera.io/mu/def456`',
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
    const { ids, invalid } = parseMuIds(musInput);
    if (invalid.length > 0) {
      await interaction.editReply({
        content: `These do not look like MU ids or links: ${invalid.join(', ')}`,
      });
      return;
    }
    if (ids.length === 0) {
      await interaction.editReply({ content: 'Please provide at least one MU id or link.' });
      return;
    }
    militaryUnitIds = ids;
  }

  const channelChanged = existing?.channelId && existing.channelId !== newChannelId;

  ServerConfigManager.updateMuDirectoryConfig(serverId, {
    channelId: newChannelId,
    militaryUnitIds,
    ...(manageRoleIds !== undefined ? { manageRoleIds } : {}),
    enabled: existing?.enabled ?? true,
    // Moving channels invalidates the old living messages.
    messageIds: channelChanged ? [] : existing?.messageIds,
  });

  await discordService.initializeServerChannel(serverId, newChannelId);

  const config = ServerConfigManager.getMuDirectoryConfig(serverId)!;
  let message = '**MU directory configured**\n\n';
  message += `**Channel:** <#${newChannelId}>\n`;
  message += `**Military units:** ${config.militaryUnitIds.length} configured\n`;
  message += `**Manage roles:** ${formatRoles(config.manageRoleIds)}\n`;
  message += `**Status:** ${config.enabled === false ? 'Disabled (use /mudirectory enable)' : 'Enabled'}`;
  if (channelChanged) {
    message += '\n\nChannel changed — new directory messages will be posted on the next refresh.';
  }
  message += '\n\nRun `/mudirectory refresh` to update the directory now.';

  await interaction.editReply({ content: message });
}

async function handleConfigView(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getMuDirectoryConfig(serverId);

  if (!config) {
    await interaction.reply({
      content:
        'The MU directory is not configured for this server.\n\nUse `/mudirectory config set` to get started.',
      ephemeral: true,
    });
    return;
  }

  const status = config.enabled !== false ? 'Enabled' : 'Disabled';
  const lastUpdated = config.lastUpdated
    ? `<t:${Math.floor(new Date(config.lastUpdated).getTime() / 1000)}:R>`
    : 'Never';

  await interaction.reply({
    content:
      '**MU Directory Settings**\n\n' +
      `**Channel:** ${config.channelId ? `<#${config.channelId}>` : 'None'}\n` +
      `**Military unit IDs:** ${config.militaryUnitIds.join(', ') || 'None'}\n` +
      `**Manage roles:** ${formatRoles(config.manageRoleIds)}\n` +
      `**Status:** ${status}\n` +
      `**Last updated:** ${lastUpdated}`,
    ephemeral: true,
  });
}

async function handleEnable(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!hasManageRoles(interaction)) {
    await replyUnauthorized(interaction, 'You need the Manage Roles permission to enable the MU directory.');
    return;
  }

  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getMuDirectoryConfig(serverId);
  if (!config) {
    await interaction.reply({
      content: 'The MU directory is not configured.\n\nUse `/mudirectory config set` first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  ServerConfigManager.updateMuDirectoryConfig(serverId, { enabled: true });

  const service = apiService.getMuDirectoryService();
  if (service) {
    try {
      await service.refreshServer(serverId);
      await interaction.editReply({ content: '**MU directory enabled.** The directory has been refreshed.' });
      return;
    } catch (error) {
      logger.error('Failed to refresh MU directory on enable', error);
      await interaction.editReply({
        content: '**MU directory enabled**, but the initial refresh failed. Check logs and try again later.',
      });
      return;
    }
  }

  await interaction.editReply({ content: '**MU directory enabled** for this server.' });
}

async function handleDisable(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!hasManageRoles(interaction)) {
    await replyUnauthorized(interaction, 'You need the Manage Roles permission to disable the MU directory.');
    return;
  }

  const serverId = interaction.guild!.id;
  if (!ServerConfigManager.getMuDirectoryConfig(serverId)) {
    await interaction.reply({ content: 'The MU directory is not configured.', ephemeral: true });
    return;
  }

  ServerConfigManager.updateMuDirectoryConfig(serverId, { enabled: false });
  await interaction.reply({
    content: '**MU directory disabled.** The last messages will remain in place.',
    ephemeral: true,
  });
}

async function handleRefresh(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getMuDirectoryConfig(serverId);

  if (!canManageFeature(interaction, config?.manageRoleIds ?? [])) {
    await replyUnauthorized(interaction);
    return;
  }

  const service = apiService.getMuDirectoryService();
  if (!service) {
    await interaction.reply({ content: 'MU directory service is not available.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await service.refreshServer(serverId);
    await interaction.editReply({ content: 'MU directory refreshed.' });
  } catch (error) {
    await interaction.editReply({
      content: error instanceof Error ? error.message : 'Failed to refresh the directory.',
    });
  }
}

function formatRoles(roleIds: string[]): string {
  return roleIds.length ? roleIds.map(id => `<@&${id}>`).join(', ') : 'None (admins only)';
}
