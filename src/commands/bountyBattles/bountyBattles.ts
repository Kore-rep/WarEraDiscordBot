import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';

/**
 * Command to manage bounty battles settings for the server
 */
export const bountyBattlesCommand: Command = {
  data: createCommandBuilder(
    'bountybattles',
    'Manage bounty battles notification settings for this server'
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
                .setDescription('The channel where battle updates will be posted')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
            )
            .addRoleOption(option =>
              option
                .setName('role')
                .setDescription('The role to mention for battle updates (optional)')
                .setRequired(false)
            )
            .addNumberOption(option =>
              option
                .setName('threshold')
                .setDescription('Minimum total bounty to trigger role mentions (default: 0)')
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
    ),

  async execute(interaction: ChatInputCommandInteraction, discordService?: DiscordService): Promise<void> {
    const subcommandGroup = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();

    if (subcommandGroup === 'config') {
      if (subcommand === 'set') {
        await handleConfigSet(interaction, discordService);
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
async function handleConfigSet(interaction: ChatInputCommandInteraction, discordService?: DiscordService): Promise<void> {
  try {
    // Ensure this is in a guild
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Get the channel option
    const channel = interaction.options.getChannel('channel', true);
    
    // Get the role option (optional)
    const role = interaction.options.getRole('role', false);
    
    // Get the threshold option (optional)
    const threshold = interaction.options.getNumber('threshold', false);

    // Validate channel is a text channel
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Please select a text channel.',
        ephemeral: true,
      });
      return;
    }

    // Get current server config
    const currentConfig = ServerConfigManager.getServerConfig(interaction.guildId);

    // Check if channel is changing
    const channelChanged = currentConfig && currentConfig.channelId !== channel.id;

    // Build new role IDs array
    const roleIds = role ? [role.id] : (currentConfig?.roleIds || []);
    
    // Determine bounty threshold
    const bountyThreshold = threshold !== null ? threshold : (currentConfig?.bountyThreshold ?? 0);

    // Update server configuration (enable by default if new)
    // This updates both in-memory cache and disk
    ServerConfigManager.updateServerConfig(interaction.guildId, {
      channelId: channel.id,
      roleIds: roleIds,
      enabled: currentConfig?.enabled !== undefined ? currentConfig.enabled : true,
      bountyThreshold: bountyThreshold,
    });

    // If channel changed, clear message tracking for this server so it starts fresh
    if (channelChanged && discordService) {
      discordService.clearServerTracking(interaction.guildId);
      logger.info(`Cleared message tracking for server ${interaction.guildId} due to channel change`);
    }

      // Build confirmation message
      let confirmationMessage = `Bounty battle notifications configured!\n\n`;
      confirmationMessage += `**Channel:** <#${channel.id}>\n`;
      confirmationMessage += `**Bounty Threshold:** ${bountyThreshold}\n`;
      
      if (role) {
        confirmationMessage += `**Role:** <@&${role.id}>`;
      } else if (roleIds.length > 0) {
        confirmationMessage += `**Roles:** ${roleIds.map(id => `<@&${id}>`).join(', ')}`;
      } else {
        confirmationMessage += `**Role:** None (no role will be mentioned)`;
      }

    // Send ephemeral confirmation message
    await interaction.reply({
      content: confirmationMessage,
      ephemeral: true,
    });

    logger.info(
      `Server ${interaction.guildId} configured: channel=${channel.id}, roles=[${roleIds.join(', ')}]`
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

    if (!config) {
        await interaction.reply({
          content: 'No bounty battles configuration found for this server.\n\nUse `/bountybattles config set` to set it up.',
          ephemeral: true,
        });
        return;
      }

      // Build configuration display message
      const isEnabled = config.enabled !== false; // Default to true if not set
      const statusText = isEnabled ? 'Enabled' : 'Disabled';
      const bountyThreshold = config.bountyThreshold ?? 0;
      
      let message = `**Bounty Battles Configuration**\n\n`;
      message += `**Status:** ${statusText}\n`;
      message += `**Channel:** <#${config.channelId}>\n`;
      message += `**Bounty Threshold:** ${bountyThreshold}\n`;
      
      if (config.roleIds && config.roleIds.length > 0) {
        message += `**Roles:** ${config.roleIds.map(id => `<@&${id}>`).join(', ')}`;
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

    if (!config) {
        await interaction.reply({
          content: 'No bounty battles configuration found for this server.\n\nUse `/bountybattles config set` to set it up first.',
          ephemeral: true,
        });
        return;
      }

      // Update server configuration to enable
      // This updates both in-memory cache and disk
      ServerConfigManager.updateServerConfig(interaction.guildId, {
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

    if (!config) {
        await interaction.reply({
          content: 'No bounty battles configuration found for this server.\n\nUse `/bountybattles config set` to set it up first.',
          ephemeral: true,
        });
        return;
      }

      // Update server configuration to disable
      // This updates both in-memory cache and disk
      ServerConfigManager.updateServerConfig(interaction.guildId, {
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
