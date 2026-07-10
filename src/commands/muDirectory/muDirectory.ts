import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { canManageFeature, isGuildAdmin, replyUnauthorized } from '../../utils/commandAuth';

export const muDirectoryCommand: Command = {
  data: createCommandBuilder(
    'mudirectory',
    'Maintain a WarEra Military-Unit directory in a channel',
    { requireAdmin: false }
  )
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Set the channel for the MU directory and enable it (admin only)')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel for the living directory (defaults to this channel)')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add a military unit to the directory')
        .addStringOption(opt =>
          opt
            .setName('mu')
            .setDescription('WarEra MU link or id')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a military unit from the directory')
        .addStringOption(opt =>
          opt
            .setName('mu')
            .setDescription('WarEra MU link or id')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list').setDescription('List the military units in the directory')
    )
    .addSubcommand(sub =>
      sub.setName('refresh').setDescription('Refresh the directory now')
    )
    .addSubcommand(sub =>
      sub.setName('disable').setDescription('Disable daily directory updates (admin only)')
    )
    .addSubcommand(sub =>
      sub
        .setName('roles')
        .setDescription('Set the roles allowed to manage the directory (admin only)')
        .addRoleOption(opt =>
          opt.setName('role1').setDescription('Allowed role').setRequired(false)
        )
        .addRoleOption(opt =>
          opt.setName('role2').setDescription('Allowed role').setRequired(false)
        )
        .addRoleOption(opt =>
          opt.setName('role3').setDescription('Allowed role').setRequired(false)
        )
        .addRoleOption(opt =>
          opt.setName('role4').setDescription('Allowed role').setRequired(false)
        )
        .addRoleOption(opt =>
          opt.setName('role5').setDescription('Allowed role').setRequired(false)
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
        await interaction.reply({ content: 'Required services are not available.', ephemeral: true });
        return;
      }

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'setup':
          await handleSetup(interaction, discordService);
          break;
        case 'add':
          await handleAdd(interaction, apiService);
          break;
        case 'remove':
          await handleRemove(interaction, apiService);
          break;
        case 'list':
          await handleList(interaction);
          break;
        case 'refresh':
          await handleRefresh(interaction, apiService);
          break;
        case 'disable':
          await handleDisable(interaction);
          break;
        case 'roles':
          await handleRoles(interaction);
          break;
        default:
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

/** Non-admin gate: member must be admin/owner or hold a configured manage role. */
function ensureCanManage(interaction: ChatInputCommandInteraction): boolean {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getMuDirectoryConfig(serverId);
  return canManageFeature(interaction, config?.manageRoleIds ?? []);
}

async function handleSetup(
  interaction: ChatInputCommandInteraction,
  discordService: DiscordService
): Promise<void> {
  if (!isGuildAdmin(interaction)) {
    await replyUnauthorized(interaction, 'Only administrators can set up the MU directory.');
    return;
  }

  const serverId = interaction.guild!.id;
  const channelOpt = interaction.options.getChannel('channel');
  const channelId =
    channelOpt?.id ??
    (interaction.channel?.isTextBased() ? interaction.channelId : undefined);

  if (!channelId) {
    await interaction.reply({
      content: 'Specify a **channel**, or run this command from a text channel.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const existing = ServerConfigManager.getMuDirectoryConfig(serverId);
  const channelChanged = existing?.channelId && existing.channelId !== channelId;

  ServerConfigManager.updateMuDirectoryConfig(serverId, {
    channelId,
    enabled: true,
    // Moving channels invalidates the old living messages.
    messageIds: channelChanged ? [] : existing?.messageIds,
  });

  await discordService.initializeServerChannel(serverId, channelId);

  await interaction.editReply({
    content:
      `**MU directory configured**\n` +
      `Channel: <#${channelId}>\n` +
      `Tracked MUs: ${existing?.units.length ?? 0}\n\n` +
      `Add units with \`/mudirectory add\`, then run \`/mudirectory refresh\`.`,
  });
}

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!ensureCanManage(interaction)) {
    await replyUnauthorized(interaction);
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const serverId = interaction.guild!.id;
  const input = interaction.options.getString('mu', true);

  const service = apiService.getMuDirectoryService();
  if (!service) {
    await interaction.editReply({ content: 'MU directory service is not available.' });
    return;
  }

  const result = await service.addUnit(serverId, input);
  if (result.status === 'invalid') {
    await interaction.editReply({
      content: 'That does not look like a WarEra MU link or id.',
    });
    return;
  }
  if (result.status === 'exists') {
    await interaction.editReply({ content: `**${result.name}** is already in the directory.` });
    return;
  }

  await interaction.editReply({
    content: `Added **${result.name}**. Run \`/mudirectory refresh\` to update the directory.`,
  });
}

async function handleRemove(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!ensureCanManage(interaction)) {
    await replyUnauthorized(interaction);
    return;
  }

  const service = apiService.getMuDirectoryService();
  if (!service) {
    await interaction.reply({ content: 'MU directory service is not available.', ephemeral: true });
    return;
  }

  const serverId = interaction.guild!.id;
  const input = interaction.options.getString('mu', true);

  const removed = service.removeUnit(serverId, input);
  await interaction.reply({
    content: removed
      ? 'Removed. Run `/mudirectory refresh` to update the directory.'
      : 'No matching military unit is tracked.',
    ephemeral: true,
  });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const config = ServerConfigManager.getMuDirectoryConfig(serverId);

  if (!config || config.units.length === 0) {
    await interaction.reply({ content: 'No military units are tracked yet.', ephemeral: true });
    return;
  }

  const lines = config.units.map((u, i) => `${i + 1}. **${u.name}** — <${u.url}>`);
  await interaction.reply({
    content: `**Tracked military units (${config.units.length})**\n${lines.join('\n')}`,
    ephemeral: true,
  });
}

async function handleRefresh(
  interaction: ChatInputCommandInteraction,
  apiService: ApiService
): Promise<void> {
  if (!ensureCanManage(interaction)) {
    await replyUnauthorized(interaction);
    return;
  }

  const serverId = interaction.guild!.id;
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

async function handleDisable(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isGuildAdmin(interaction)) {
    await replyUnauthorized(interaction, 'Only administrators can disable the MU directory.');
    return;
  }

  const serverId = interaction.guild!.id;
  if (!ServerConfigManager.getMuDirectoryConfig(serverId)) {
    await interaction.reply({ content: 'The MU directory is not configured.', ephemeral: true });
    return;
  }

  ServerConfigManager.updateMuDirectoryConfig(serverId, { enabled: false });
  await interaction.reply({ content: 'Daily MU directory updates disabled.', ephemeral: true });
}

async function handleRoles(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isGuildAdmin(interaction)) {
    await replyUnauthorized(interaction, 'Only administrators can set manage roles.');
    return;
  }

  const serverId = interaction.guild!.id;
  const roleIds: string[] = [];
  for (const name of ['role1', 'role2', 'role3', 'role4', 'role5']) {
    const role = interaction.options.getRole(name);
    if (role) {
      roleIds.push(role.id);
    }
  }

  ServerConfigManager.setMuDirectoryManageRoles(serverId, roleIds);
  await interaction.reply({
    content: roleIds.length
      ? `Roles allowed to manage the directory: ${roleIds.map(id => `<@&${id}>`).join(', ')}`
      : 'Cleared manage roles. Only administrators can manage the directory now.',
    ephemeral: true,
  });
}
