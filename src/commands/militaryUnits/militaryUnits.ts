import { ChatInputCommandInteraction, PermissionFlagsBits } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import { MilitaryUnitService } from '../../services/militaryUnits/MilitaryUnitService';
import { parseMuInput } from '../../services/muDirectory/muLink';

/**
 * `/mu` — manage the shared per-server military-unit list consumed by the
 * leaderboard, the MU directory, and autorole role mapping.
 */
export const militaryUnitsCommand: Command = {
  data: createCommandBuilder('mu', 'Manage the shared military-unit list (leaderboard, directory, autorole)', {
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
  })
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add an MU to the shared list (or refresh its name)')
        .addStringOption(opt => opt.setName('mu').setDescription('MU id or app.warera.io/mu/... link').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove an MU from the shared list')
        .addStringOption(opt => opt.setName('mu').setDescription('MU id or link').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('role')
        .setDescription('Map an MU to a Discord role for autorole (adds it to the list if needed)')
        .addStringOption(opt => opt.setName('mu').setDescription('MU id or link').setRequired(true))
        .addRoleOption(opt => opt.setName('role').setDescription('Role for members of this MU').setRequired(true))
    )
    .addSubcommand(sub =>
      sub
        .setName('role-clear')
        .setDescription('Clear an MU\'s role mapping (the MU stays in the list)')
        .addStringOption(opt => opt.setName('mu').setDescription('MU id or link').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('list').setDescription('List the shared MUs and their roles')),

  async execute(
    interaction: ChatInputCommandInteraction,
    _discordService?: DiscordService,
    apiService?: ApiService
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a Discord server.', ephemeral: true });
        return;
      }
      if (!apiService) {
        await interaction.reply({ content: 'The military-unit service is not available.', ephemeral: true });
        return;
      }

      const service = new MilitaryUnitService(apiService);
      const serverId = interaction.guild.id;
      const sub = interaction.options.getSubcommand();

      if (sub === 'list') {
        const units = service.getUnits(serverId);
        if (units.length === 0) {
          await interaction.reply({ content: 'No military units configured. Add one with `/mu add`.', ephemeral: true });
          return;
        }
        const lines = units.map(u => `- **${u.muName}** (\`${u.muId}\`): ${u.roleId ? `<@&${u.roleId}>` : '*TBD*'}`);
        await interaction.reply({ content: `**Military units** (${units.length})\n${lines.join('\n')}`, ephemeral: true });
        return;
      }

      let muId: string;
      try {
        muId = parseMuInput(interaction.options.getString('mu', true)).id;
      } catch (error) {
        await interaction.reply({ content: (error as Error).message, ephemeral: true });
        return;
      }

      if (sub === 'add') {
        await interaction.deferReply({ ephemeral: true });
        const result = await service.addUnit(serverId, muId);
        if (!result) {
          await interaction.editReply({ content: `No military unit found for id \`${muId}\`.` });
          return;
        }
        await interaction.editReply({
          content: result.created
            ? `Added **${result.entry.muName}** (\`${muId}\`) to the shared list.`
            : `Refreshed **${result.entry.muName}** (\`${muId}\`).`,
        });
        return;
      }

      if (sub === 'remove') {
        const removed = service.removeUnit(serverId, muId);
        await interaction.reply({
          content: removed ? `Removed MU \`${muId}\` from the shared list.` : `MU \`${muId}\` is not in the list.`,
          ephemeral: true,
        });
        return;
      }

      if (sub === 'role') {
        const role = interaction.options.getRole('role', true);
        await interaction.deferReply({ ephemeral: true });
        const entry = await service.setRole(serverId, muId, role.id);
        if (!entry) {
          await interaction.editReply({ content: `No military unit found for id \`${muId}\`.` });
          return;
        }
        await interaction.editReply({ content: `Members of **${entry.muName}** (\`${muId}\`) now get <@&${role.id}>.` });
        return;
      }

      if (sub === 'role-clear') {
        const cleared = service.clearRole(serverId, muId);
        await interaction.reply({
          content: cleared ? `Cleared the role for MU \`${muId}\`.` : `MU \`${muId}\` has no role mapping.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
    } catch (error) {
      logger.error('Error in mu command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  },
};
