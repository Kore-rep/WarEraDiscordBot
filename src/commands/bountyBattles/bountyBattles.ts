import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { COMMAND_HELP } from '../help/helpTexts';

/**
 * Command to manage bounty battles settings for the server
 */
export const bountyBattlesCommand: Command = {
  data: createCommandBuilder(
    'bountybattles',
    'Manage bounty battles notification settings for this server',
    { requireAdmin: false }
  )
    .addSubcommandGroup(group =>
      group
        .setName('config')
        .setDescription('Configure bounty battles settings')
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription('Set bounty battles notification settings')
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('Channel for notifications (leave empty to keep current)')
                .setRequired(false)
                .addChannelTypes(ChannelType.GuildText)
            )
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('Role to mention (empty=keep, @null=remove)')
                .setRequired(false)
            )
            .addNumberOption(option =>
              option
                .setName('threshold')
                .setDescription('Min bounty for role mentions (empty=keep)')
                .setRequired(false)
                .setMinValue(0)
            )
            .addNumberOption(option =>
              option
                .setName('min')
                .setDescription('Min bounty to send any message; below this no message sent (empty=keep, 0=all)')
                .setRequired(false)
                .setMinValue(0)
            )
            .addNumberOption(option =>
              option
                .setName('minpool')
                .setDescription('Min total pool to send any message; below this no message sent (empty=keep, 0=all)')
                .setRequired(false)
                .setMinValue(0)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('view')
            .setDescription('View current bounty battles configuration for this server')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable')
        .setDescription('Enable bounty battle notifications for this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable bounty battle notifications for this server')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('help').setDescription('How bounty battle alerts work')
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    if (!subcommandGroup && subcommand === 'help') {
      await interaction.reply({ content: COMMAND_HELP.bountybattles, ephemeral: true });
    } else if (subcommandGroup === 'config') {
      if (subcommand === 'set') {
        await handleConfigSet(interaction);
      } else if (subcommand === 'view') {
        await handleConfigView(interaction);
      }
    } else if (subcommand === 'enable') {
      await handleEnable(interaction);
    } else if (subcommand === 'disable') {
      await handleDisable(interaction);
    }
  },
};

/**
 * Handle the config set subcommand
 */
async function handleConfigSet(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Ensure this is in a guild
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Get options (all optional now)
    const channel = interaction.options.getChannel('channel', false);
    const role = interaction.options.getRole('role', false);
    const threshold = interaction.options.getNumber('threshold', false);
    const minBountyToSend = interaction.options.getNumber('min', false);
    const minPool = interaction.options.getNumber('minpool', false);

    // Get current server config
    const currentConfig = ServerConfigManager.getServerConfig(interaction.guildId);
    const currentBountyConfig = currentConfig?.bountyBattles;

    // If no current config exists and no channel provided, require channel
    if (!currentBountyConfig && !channel) {
      await interaction.reply({
        content: 'No configuration exists yet. Please specify a channel to get started.\n\nExample: `/bountybattles config set channel:#bounty-battles`',
        ephemeral: true,
      });
      return;
    }

    // Validate channel if provided
    if (channel && channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Please select a text channel.',
        ephemeral: true,
      });
      return;
    }

    // Determine new channel ID (use provided or keep existing)
    const newChannelId = channel ? channel.id : currentBountyConfig!.channelId;

    // Build new role IDs array
    let roleIds: string[];
    
    if (role) {
      // Check if user wants to remove the role (by selecting a role named "null")
      if (role.name.toLowerCase() === 'null') {
        roleIds = []; // Remove all roles
      } else {
        roleIds = [role.id]; // Set new role
      }
    } else {
      // No role provided, preserve existing
      roleIds = currentBountyConfig?.roleIds || [];
    }
    
    // Determine bounty threshold (use provided or keep existing)
    const bountyThreshold = threshold !== null ? threshold : (currentBountyConfig?.bountyThreshold ?? 0);
    // minBountyToSend: undefined = not set (send all), 0 = send all, >0 = only send if totalBounty >= value
    const resolvedMinBountyToSend = minBountyToSend !== null ? minBountyToSend : currentBountyConfig?.minBountyToSend;
    // minPool: undefined = not set (send all), 0 = send all, >0 = only send if moneyPool >= value
    const resolvedMinPool = minPool !== null ? minPool : currentBountyConfig?.minPool;

    // Update bounty battles configuration (enable by default if new)
    // This updates both in-memory cache and disk
    ServerConfigManager.updateBountyBattlesConfig(interaction.guildId, {
      channelId: newChannelId,
      roleIds: roleIds,
      enabled: currentBountyConfig?.enabled !== undefined ? currentBountyConfig.enabled : true,
      bountyThreshold: bountyThreshold,
      minBountyToSend: resolvedMinBountyToSend,
      minPool: resolvedMinPool,
    });

    // Build confirmation message
    let confirmationMessage = `Bounty battle notifications configured!\n\n`;
    confirmationMessage += `**Channel:** <#${newChannelId}>\n`;
    confirmationMessage += `**Bounty Threshold:** ${bountyThreshold}\n`;
        const minDisplay = resolvedMinBountyToSend !== undefined && resolvedMinBountyToSend !== null
      ? (resolvedMinBountyToSend === 0 ? '0 (send all)' : resolvedMinBountyToSend)
      : 'None (send all)';
    confirmationMessage += `**Min bounty to send:** ${minDisplay}\n`;
    const minPoolDisplay = resolvedMinPool !== undefined && resolvedMinPool !== null
      ? (resolvedMinPool === 0 ? '0 (send all)' : resolvedMinPool)
      : 'None (send all)';
    confirmationMessage += `**Min pool to send:** ${minPoolDisplay}\n`;

    if (roleIds.length > 0) {
      confirmationMessage += `**Roles:** ${roleIds.map(id => `<@&${id}>`).join(', ')}`;
    } else {
      confirmationMessage += `**Role:** None`;
    }

    // Add info about what was updated
    const updates: string[] = [];
    if (channel) updates.push('channel');
    if (role) updates.push(role.name.toLowerCase() === 'null' ? 'role (removed)' : 'role');
    if (threshold !== null) updates.push('threshold');
    if (minBountyToSend !== null) updates.push('min');
    if (minPool !== null) updates.push('minpool');

    if (updates.length > 0) {
      confirmationMessage += `\n\n*Updated: ${updates.join(', ')}*`;
    }

    // Send ephemeral confirmation message
    await interaction.reply({
      content: confirmationMessage,
      ephemeral: true,
    });

    logger.info(
      `Server ${interaction.guildId} configured: channel=${newChannelId}, roles=[${roleIds.join(', ')}], threshold=${bountyThreshold}, minBountyToSend=${resolvedMinBountyToSend ?? 'none'}, minPool=${resolvedMinPool ?? 'none'}`
    );
  } catch (error) {
    logger.error('Error executing bountybattles config set command', error);
    
          await interaction.reply({
            content: 'An error occurred while configuring bounty battles. Please try again.',
            ephemeral: true,
          });
  }
}

/**
 * Handle the config view subcommand
 */
async function handleConfigView(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Ensure this is in a guild
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Get current server config
    const config = ServerConfigManager.getServerConfig(interaction.guildId);
    const bountyBattlesConfig = config?.bountyBattles;

    if (!bountyBattlesConfig) {
        await interaction.reply({
          content: 'No bounty battles configuration found for this server.\n\nUse `/bountybattles config set` to set it up.',
          ephemeral: true,
        });
        return;
      }

      // Build configuration display message
      const isEnabled = bountyBattlesConfig.enabled !== false; // Default to true if not set
      const statusText = isEnabled ? 'Enabled' : 'Disabled';
      const bountyThreshold = bountyBattlesConfig.bountyThreshold ?? 0;
      const minBountyToSendDisplay = bountyBattlesConfig.minBountyToSend !== undefined && bountyBattlesConfig.minBountyToSend !== null
        ? bountyBattlesConfig.minBountyToSend
        : 'None (send all)';
      const minPoolDisplay = bountyBattlesConfig.minPool !== undefined && bountyBattlesConfig.minPool !== null
        ? bountyBattlesConfig.minPool
        : 'None (send all)';

      let message = `**Bounty Battles Configuration**\n\n`;
      message += `**Status:** ${statusText}\n`;
      message += `**Channel:** <#${bountyBattlesConfig.channelId}>\n`;
      message += `**Bounty Threshold:** ${bountyThreshold}\n`;
      message += `**Min bounty to send:** ${minBountyToSendDisplay}\n`;
      message += `**Min pool to send:** ${minPoolDisplay}\n`;

      if (bountyBattlesConfig.roleIds && bountyBattlesConfig.roleIds.length > 0) {
        message += `**Roles:** ${bountyBattlesConfig.roleIds.map(id => `<@&${id}>`).join(', ')}`;
      } else {
        message += `**Roles:** None (no role will be mentioned)`;
      }

    // Send ephemeral response
    await interaction.reply({
      content: message,
      ephemeral: true,
    });

    logger.info(`Server ${interaction.guildId} configuration viewed`);
  } catch (error) {
    logger.error('Error executing bountybattles config view command', error);
    
        await interaction.reply({
          content: 'An error occurred while retrieving the configuration. Please try again.',
          ephemeral: true,
        });
  }
}

/**
 * Handle the enable subcommand
 */
async function handleEnable(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Ensure this is in a guild
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Get current server config
    const config = ServerConfigManager.getServerConfig(interaction.guildId);

    if (!config?.bountyBattles) {
        await interaction.reply({
          content: 'No bounty battles configuration found for this server.\n\nUse `/bountybattles config set` to set it up first.',
          ephemeral: true,
        });
        return;
      }

      // Update bounty battles configuration to enable
      // This updates both in-memory cache and disk
      ServerConfigManager.updateBountyBattlesConfig(interaction.guildId, {
        enabled: true,
      });

      // Send confirmation message
      await interaction.reply({
        content: 'Bounty battle notifications have been **enabled** for this server.',
        ephemeral: true,
      });

    logger.info(`Server ${interaction.guildId} bounty battles enabled`);
  } catch (error) {
    logger.error('Error executing bountybattles enable command', error);
    
        await interaction.reply({
          content: 'An error occurred while enabling bounty battles. Please try again.',
          ephemeral: true,
        });
  }
}

/**
 * Handle the disable subcommand
 */
async function handleDisable(interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Ensure this is in a guild
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Get current server config
    const config = ServerConfigManager.getServerConfig(interaction.guildId);

    if (!config?.bountyBattles) {
        await interaction.reply({
          content: 'No bounty battles configuration found for this server.\n\nUse `/bountybattles config set` to set it up first.',
          ephemeral: true,
        });
        return;
      }

      // Update bounty battles configuration to disable
      // This updates both in-memory cache and disk
      ServerConfigManager.updateBountyBattlesConfig(interaction.guildId, {
        enabled: false,
      });

      // Send confirmation message
      await interaction.reply({
        content: 'Bounty battle notifications have been **disabled** for this server.',
        ephemeral: true,
      });

    logger.info(`Server ${interaction.guildId} bounty battles disabled`);
  } catch (error) {
    logger.error('Error executing bountybattles disable command', error);
    
        await interaction.reply({
          content: 'An error occurred while disabling bounty battles. Please try again.',
          ephemeral: true,
        });
  }
}
