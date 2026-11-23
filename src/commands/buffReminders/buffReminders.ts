import { ChatInputCommandInteraction } from 'discord.js';
import { DiscordService } from '../../services/discord/DiscordService';
import { Command, createCommandBuilder } from '../types';
import { logger } from '../../utils/logger';
import { COMMAND_HELP } from '../help/helpTexts';
import { hasManageRoles } from '../../utils/commandAuth';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import {
  describeBuffReminderChoices,
  optInBuffReminders,
  optOutBuffReminders,
} from '../../services/buffReminders/BuffReminderService';

const STAFF_SUBCOMMANDS = new Set(['enable', 'disable']);

/**
 * `/buffreminders` — linked members opt in to DMs 10 minutes before their buff
 * (pill) ends, when it ends, and when the debuff after it ends. Staff can turn the
 * feature off for the server.
 */
export const buffRemindersCommand: Command = {
  data: createCommandBuilder('buffreminders', 'Get a DM before and when your buff or debuff ends', { requireAdmin: false })
    .addSubcommand(sub =>
      sub
        .setName('on')
        .setDescription('DM me when my buff ends (run again to change the options)')
        .addBooleanOption(opt => opt.setName('prewarning').setDescription('Also DM 10 minutes before the buff ends (default: yes)'))
        .addBooleanOption(opt => opt.setName('debuffend').setDescription('Also DM when the debuff is over (default: yes)'))
    )
    .addSubcommand(sub => sub.setName('off').setDescription('Stop buff / debuff DMs'))
    .addSubcommand(sub => sub.setName('help').setDescription('How buff reminders work'))
    .addSubcommand(sub => sub.setName('status').setDescription('Show reminder settings'))
    .addSubcommand(sub => sub.setName('enable').setDescription('(Staff) Allow buff reminders on this server'))
    .addSubcommand(sub => sub.setName('disable').setDescription('(Staff) Stop buff reminders for everyone on this server')),

  async execute(interaction: ChatInputCommandInteraction, discordService?: DiscordService): Promise<void> {
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
        if (!discordService) {
          await interaction.reply({ content: 'The Discord service is not available.', ephemeral: true });
          return;
        }
        await interaction.deferReply({ ephemeral: true });
        const choices = {
          preWarning: interaction.options.getBoolean('prewarning') ?? true,
          debuffEnd: interaction.options.getBoolean('debuffend') ?? true,
        };
        const result = await optInBuffReminders(serverId, interaction.user.id, choices, discordService);
        const content = {
          ok: "Buff reminders are on. Check your DMs, I've sent a confirmation.",
          updated: `Updated. I'll DM you ${describeBuffReminderChoices(choices)}.`,
          disabled: 'Buff reminders are disabled on this server.',
          'not-linked': 'Link your WarEra account first with `/link`.',
          'dm-blocked': "I couldn't DM you. Allow direct messages from server members (Privacy Settings), then try again.",
        }[result];
        await interaction.editReply({ content });
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
        const enabled = cfg?.enabled ?? true;
        const mine = cfg?.subscribers.find(s => s.discordUserId === interaction.user.id);
        await interaction.reply({
          content:
            `Buff reminders on this server: ${enabled ? 'enabled' : 'disabled'}\n` +
            `Members signed up: ${cfg?.subscribers.length ?? 0}\n` +
            `You: ${mine ? `signed up, DMs ${describeBuffReminderChoices(mine)}` : 'not signed up'}`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'enable' || sub === 'disable') {
        ServerConfigManager.updateBuffRemindersConfig(serverId, { enabled: sub === 'enable' });
        await interaction.reply({
          content:
            sub === 'enable'
              ? 'Buff reminders enabled. Members sign up with `/buffreminders on`.'
              : 'Buff reminders disabled. Sign-ups are kept; run `/buffreminders enable` to resume.',
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
