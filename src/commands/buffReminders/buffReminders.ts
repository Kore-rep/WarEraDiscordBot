import { ChannelType, ChatInputCommandInteraction } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { logger } from '../../utils/logger';
import { COMMAND_HELP } from '../help/helpTexts';
import { hasManageRoles } from '../../utils/commandAuth';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { optInBuffReminders, optOutBuffReminders } from '../../services/buffReminders/BuffReminderService';

const STAFF_SUBCOMMANDS = new Set(['setup', 'disable']);

/**
 * `/buffreminders` — linked members opt in to a ping when their buff (pill) wears
 * off and when the debuff after it ends. Staff choose the channel.
 */
export const buffRemindersCommand: Command = {
  data: createCommandBuilder('buffreminders', 'Get pinged when your buff or debuff ends', { requireAdmin: false })
    .addSubcommand(sub => sub.setName('on').setDescription('Ping me when my buff wears off and when my debuff ends'))
    .addSubcommand(sub => sub.setName('off').setDescription('Stop buff / debuff pings'))
    .addSubcommand(sub => sub.setName('help').setDescription('How buff reminders work'))
    .addSubcommand(sub => sub.setName('status').setDescription('Show reminder settings'))
    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('(Staff) Set the channel reminders are posted in and enable them')
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to post reminders in')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(sub => sub.setName('disable').setDescription('(Staff) Stop posting reminders for everyone')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a Discord server.', ephemeral: true });
        return;
      }
      const serverId = interaction.guild.id;
      const sub = interaction.options.getSubcommand();
      if (sub === 'help') {
        await interaction.reply({ content: COMMAND_HELP.buffreminders, ephemeral: true });
        return;
      }
      if (STAFF_SUBCOMMANDS.has(sub) && !hasManageRoles(interaction)) {
        await interaction.reply({ content: 'You need the Manage Roles permission to do that.', ephemeral: true });
        return;
      }
      const cfg = ServerConfigManager.getBuffRemindersConfig(serverId);

      if (sub === 'on') {
        const result = await optInBuffReminders(serverId, interaction.user.id);
        const content = {
          ok: `You'll be pinged in <#${cfg?.channelId}> when your buff wears off and when your debuff ends.`,
          'not-setup': 'Buff reminders are not set up on this server. Ask staff to run `/buffreminders setup`.',
          'not-linked': 'Link your WarEra account first with `/link`.',
        }[result];
        await interaction.reply({ content, ephemeral: true });
        return;
      }

      if (sub === 'off') {
        const removed = optOutBuffReminders(serverId, interaction.user.id);
        await interaction.reply({
          content: removed ? 'Buff reminders turned off.' : 'You were not signed up for buff reminders.',
          ephemeral: true,
        });
        return;
      }

      if (sub === 'status') {
        const active = !!cfg?.enabled && !!cfg.channelId;
        const optedIn = cfg?.optedInDiscordUserIds.includes(interaction.user.id) ?? false;
        await interaction.reply({
          content:
            `Buff reminders: ${active ? `enabled in <#${cfg!.channelId}>` : 'not active'}\n` +
            `Members signed up: ${cfg?.optedInDiscordUserIds.length ?? 0}\n` +
            `You: ${optedIn ? 'signed up' : 'not signed up'}`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel', true);
        ServerConfigManager.updateBuffRemindersConfig(serverId, { enabled: true, channelId: channel.id });
        await interaction.reply({
          content: `Buff reminders will be posted in <#${channel.id}>. Members sign up with \`/buffreminders on\`.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'disable') {
        ServerConfigManager.updateBuffRemindersConfig(serverId, { enabled: false });
        await interaction.reply({
          content: 'Buff reminders disabled. Sign-ups are kept; run `/buffreminders setup` to re-enable.',
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    } catch (error) {
      logger.error('Error in buffreminders command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};
