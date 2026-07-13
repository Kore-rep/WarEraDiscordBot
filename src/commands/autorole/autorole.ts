import { ChatInputCommandInteraction, ChannelType, PermissionFlagsBits } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { ApiService } from '../../services/api/ApiService';
import {
  handleBuildRole,
  handleConfig,
  handleCountry,
  handleLevelRole,
  handleLinkMessage,
  handleLinks,
  handleMuRole,
  handleSync,
  handleTimedRole,
} from './autoroleHandlers';

const ROLE_LIST_OPTIONS = ['role1', 'role2', 'role3', 'role4', 'role5'] as const;

export const autoroleCommand: Command = {
  data: createCommandBuilder('autorole', 'Configure WarEra account linking and role sync', {
    defaultMemberPermissions: PermissionFlagsBits.ManageRoles,
  })
    .addSubcommandGroup(group =>
      group
        .setName('levelrole')
        .setDescription('Roles granted by WarEra level')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add or update a level role')
            .addRoleOption(opt => opt.setName('role').setDescription('Role to grant').setRequired(true))
            .addIntegerOption(opt =>
              opt.setName('min_level').setDescription('Minimum WarEra level').setRequired(true).setMinValue(0)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove a level role')
            .addRoleOption(opt => opt.setName('role').setDescription('Role to remove').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('List configured level roles'))
    )
    .addSubcommandGroup(group =>
      group
        .setName('timedrole')
        .setDescription('Roles removed after WarEra inactivity')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Add or update a timed role')
            .addRoleOption(opt => opt.setName('role').setDescription('Role to remove on inactivity').setRequired(true))
            .addNumberOption(opt =>
              opt.setName('days').setDescription('Days of inactivity before removal').setRequired(true).setMinValue(0.1)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove a timed role rule')
            .addRoleOption(opt => opt.setName('role').setDescription('Role rule to remove').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('List configured timed roles'))
    )
    .addSubcommandGroup(group =>
      group
        .setName('buildrole')
        .setDescription('Eco/war/hybrid build roles')
        .addSubcommand(sub =>
          sub
            .setName('set')
            .setDescription('Set build roles and thresholds (only the options you pass change)')
            .addRoleOption(opt => opt.setName('eco_role').setDescription('Role for eco builds').setRequired(false))
            .addRoleOption(opt => opt.setName('war_role').setDescription('Role for war builds').setRequired(false))
            .addRoleOption(opt => opt.setName('hybrid_role').setDescription('Role for hybrid builds').setRequired(false))
            .addNumberOption(opt =>
              opt.setName('eco_threshold').setDescription('Eco % to earn the eco role (0-100)').setRequired(false).setMinValue(0).setMaxValue(100)
            )
            .addNumberOption(opt =>
              opt.setName('war_threshold').setDescription('War % to earn the war role (0-100)').setRequired(false).setMinValue(0).setMaxValue(100)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('clear')
            .setDescription('Clear build roles')
            .addStringOption(opt =>
              opt
                .setName('which')
                .setDescription('Which build role to clear')
                .setRequired(true)
                .addChoices(
                  { name: 'eco', value: 'eco' },
                  { name: 'war', value: 'war' },
                  { name: 'hybrid', value: 'hybrid' },
                  { name: 'all', value: 'all' }
                )
            )
        )
        .addSubcommand(sub => sub.setName('view').setDescription('View build role configuration'))
    )
    .addSubcommandGroup(group =>
      group
        .setName('murole')
        .setDescription('Roles mapped to WarEra military units')
        .addSubcommand(sub =>
          sub
            .setName('set')
            .setDescription('Map a military unit to a role')
            .addRoleOption(opt => opt.setName('role').setDescription('Role for members of this MU').setRequired(true))
            .addStringOption(opt => opt.setName('mu').setDescription('MU id or app.warera.io/mu/... link').setRequired(true))
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Remove an MU mapping')
            .addStringOption(opt => opt.setName('mu').setDescription('MU id or link').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('List MU role mappings'))
    )
    .addSubcommandGroup(group =>
      group
        .setName('country')
        .setDescription('Countries whose citizens may link without review')
        .addSubcommand(sub =>
          sub
            .setName('add')
            .setDescription('Allow a country')
            .addStringOption(opt => opt.setName('id').setDescription('WarEra country id').setRequired(true))
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Disallow a country')
            .addStringOption(opt => opt.setName('id').setDescription('WarEra country id').setRequired(true))
        )
        .addSubcommand(sub => sub.setName('list').setDescription('List allowed countries'))
    )
    .addSubcommandGroup(group =>
      group
        .setName('links')
        .setDescription('Manage linked members and pending requests')
        .addSubcommand(sub => sub.setName('list').setDescription('List linked members'))
        .addSubcommand(sub =>
          sub.setName('full').setDescription('List linked members with WarEra details (slower)')
        )
        .addSubcommand(sub => sub.setName('pending').setDescription('List link requests awaiting review'))
        .addSubcommand(sub =>
          sub
            .setName('unlink')
            .setDescription("Remove a member's link")
            .addUserOption(opt => opt.setName('user').setDescription('Member to unlink').setRequired(true))
        )
        .addSubcommand(sub =>
          sub
            .setName('approve')
            .setDescription('Approve a pending link request')
            .addUserOption(opt => opt.setName('user').setDescription('Member whose request to approve').setRequired(true))
        )
        .addSubcommand(sub =>
          sub
            .setName('deny')
            .setDescription('Deny a pending link request')
            .addUserOption(opt => opt.setName('user').setDescription('Member whose request to deny').setRequired(true))
            .addStringOption(opt => opt.setName('reason').setDescription('Reason sent to the member').setRequired(false))
        )
    )
    .addSubcommandGroup(group => {
      group
        .setName('config')
        .setDescription('General autorole configuration')
        .addSubcommand(sub => sub.setName('view').setDescription('View the full autorole configuration'))
        .addSubcommand(sub =>
          sub
            .setName('set')
            .setDescription('Set general options (only passed options change)')
            .addChannelOption(opt =>
              opt
                .setName('review_channel')
                .setDescription('Channel for link review requests')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
            )
            .addBooleanOption(opt =>
              opt.setName('skip_verification').setDescription('Link without company-rename verification').setRequired(false)
            )
            .addIntegerOption(opt =>
              opt.setName('interval_seconds').setDescription('Seconds between role syncs (min 60)').setRequired(false).setMinValue(60)
            )
            .addBooleanOption(opt =>
              opt.setName('enabled').setDescription('Enable or disable the periodic sync').setRequired(false)
            )
            .addBooleanOption(opt =>
              opt.setName('sync_nicknames').setDescription('Whether sync manages nicknames').setRequired(false)
            )
        );
      for (const [name, description] of [
        ['staffroles', 'Roles allowed to act on review buttons (replaces the list)'],
        ['staffusers', 'Users allowed to act on review buttons (replaces the list)'],
        ['proxyroles', 'Roles that bypass the country check when linking (replaces the list)'],
        ['protectedroles', 'Roles the sync must never remove (replaces the list)'],
      ] as const) {
        group.addSubcommand(sub => {
          sub.setName(name).setDescription(description);
          if (name === 'staffusers') {
            sub.addStringOption(opt =>
              opt
                .setName('users')
                .setDescription('Comma-separated user ids or mentions (empty to clear)')
                .setRequired(false)
            );
          } else {
            for (const optName of ROLE_LIST_OPTIONS) {
              sub.addRoleOption(opt =>
                opt.setName(optName).setDescription('Role (leave all empty to clear the list)').setRequired(false)
              );
            }
          }
          return sub;
        });
      }
      return group;
    })
    .addSubcommandGroup(group =>
      group
        .setName('sync')
        .setDescription('Run or inspect the role sync')
        .addSubcommand(sub =>
          sub
            .setName('now')
            .setDescription('Sync all linked members now (or one member)')
            .addUserOption(opt => opt.setName('user').setDescription('Only sync this member').setRequired(false))
        )
        .addSubcommand(sub => sub.setName('status').setDescription('Show sync status and counts'))
    )
    .addSubcommandGroup(group =>
      group
        .setName('linkmessage')
        .setDescription('Persistent "Link WarEra" button messages')
        .addSubcommand(sub =>
          sub
            .setName('post')
            .setDescription('Post a link-button message')
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel to post in (defaults to this channel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
            )
        )
        .addSubcommand(sub =>
          sub
            .setName('remove')
            .setDescription('Delete the link-button message in a channel')
            .addChannelOption(opt =>
              opt
                .setName('channel')
                .setDescription('Channel whose link message to delete (defaults to this channel)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
            )
        )
    ),

  async execute(
    interaction: ChatInputCommandInteraction,
    discordService?: DiscordService,
    apiService?: ApiService
  ): Promise<void> {
    try {
      if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a Discord server.', ephemeral: false });
        return;
      }
      const service = apiService?.getAutoroleService();
      if (!service || !discordService) {
        await interaction.reply({ content: 'The autorole service is not available.', ephemeral: false });
        return;
      }

      const group = interaction.options.getSubcommandGroup(false);
      switch (group) {
        case 'levelrole':
          await handleLevelRole(interaction);
          return;
        case 'timedrole':
          await handleTimedRole(interaction);
          return;
        case 'buildrole':
          await handleBuildRole(interaction);
          return;
        case 'murole':
          await handleMuRole(interaction, service);
          return;
        case 'country':
          await handleCountry(interaction);
          return;
        case 'links':
          await handleLinks(interaction, service);
          return;
        case 'config':
          await handleConfig(interaction, discordService);
          return;
        case 'sync':
          await handleSync(interaction, service);
          return;
        case 'linkmessage':
          await handleLinkMessage(interaction, discordService);
          return;
        default:
          await interaction.reply({ content: 'Unknown subcommand.', ephemeral: false });
      }
    } catch (error) {
      logger.error('Error in autorole command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: false });
      } else {
        await interaction.reply({ content, ephemeral: false });
      }
    }
  },
};
