import { ChatInputCommandInteraction, ChannelType } from 'discord.js';
import { Command, createCommandBuilder } from '../types';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { logger } from '../../utils/logger';
import { DiscordService } from '../../services/discord/DiscordService';
import { COMMAND_HELP } from '../help/helpTexts';

/**
 * Command to manage mercenary contract notification settings for the server
 */
export const contractsCommand: Command = {
  data: createCommandBuilder(
    'contracts',
    'Manage mercenary contract notification settings for this server',
    { requireAdmin: false }
  )
    .addSubcommandGroup(group =>
      group
        .setName('config')
        .setDescription('Configure mercenary contract settings')
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription('Set mercenary contract notification settings')
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
                .setDescription('Min gold per 1k damage for role mentions (empty=keep)')
                .setRequired(false)
                .setMinValue(0)
            )
            .addNumberOption(option =>
              option
                .setName('min')
                .setDescription('Min gold per 1k to send any message; below this no message sent (empty=keep, 0=all)')
                .setRequired(false)
                .setMinValue(0)
            )
            .addNumberOption(option =>
              option
                .setName('minpayout')
                .setDescription('Min contract payout to send any message; below this no message sent (empty=keep, 0=all)')
                .setRequired(false)
                .setMinValue(0)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('view')
            .setDescription('View current mercenary contract notification settings')
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('enable')
        .setDescription('Enable mercenary contract notifications')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('disable')
        .setDescription('Disable mercenary contract notifications')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('help').setDescription('How mercenary contract alerts work')
    ),

  async execute(interaction: ChatInputCommandInteraction, discordService?: DiscordService): Promise<void> {
    try {
      // Check if in guild
      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command can only be used in a Discord server.',
          ephemeral: true
        });
        return;
      }

      const subcommandGroup = interaction.options.getSubcommandGroup(false);
      const subcommand = interaction.options.getSubcommand();

      if (!subcommandGroup && subcommand === 'help') {
        await interaction.reply({ content: COMMAND_HELP.contracts, ephemeral: true });
      } else if (subcommandGroup === 'config' && subcommand === 'set') {
        await handleConfigSet(interaction, discordService!);
      } else if (subcommandGroup === 'config' && subcommand === 'view') {
        await handleConfigView(interaction);
      } else if (subcommand === 'enable') {
        await handleEnable(interaction, discordService!);
      } else if (subcommand === 'disable') {
        await handleDisable(interaction, discordService!);
      }
    } catch (error) {
      logger.error('Error in contracts command', error);
      const content = 'An error occurred while processing the command.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  }
};

/**
 * Handle /contracts config set command
 */
async function handleConfigSet(interaction: ChatInputCommandInteraction, discordService: DiscordService): Promise<void> {
  const serverId = interaction.guild!.id;
  const channel = interaction.options.getChannel('channel', false);
  const role = interaction.options.getRole('role', false);
  const threshold = interaction.options.getNumber('threshold', false);
  const minContractToSend = interaction.options.getNumber('min', false);
  const minPayout = interaction.options.getNumber('minpayout', false);

  // Get current configuration or create new one
  const currentConfig = ServerConfigManager.getServerConfig(serverId);
  const existingMercenaryConfig = currentConfig?.mercenaryContracts;

  // If no current config exists and no channel provided, require channel
  if (!existingMercenaryConfig && !channel) {
    await interaction.reply({
      content: 'No configuration exists yet. Please specify a channel to get started.\n\nExample: `/contracts config set channel:#mercenary-contracts`',
      ephemeral: true
    });
    return;
  }

  // Validate channel if provided
  if (channel && channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Please select a text channel for mercenary contract notifications.',
      ephemeral: true
    });
    return;
  }

  // Determine new channel ID (use provided or keep existing)
  const newChannelId = channel ? channel.id : existingMercenaryConfig!.channelId;

  // Handle role configuration
  let newRoleIds: string[];
  if (role) {
    if (role.name.toLowerCase() === 'null') {
      // Clear role mentions
      newRoleIds = [];
    } else {
      // Set new role
      newRoleIds = [role.id];
    }
  } else {
    // Keep existing roleIds if no role provided
    newRoleIds = existingMercenaryConfig?.roleIds || [];
  }

  // Determine contract threshold (use provided or keep existing)
  const contractThreshold = threshold !== null ? threshold : (existingMercenaryConfig?.contractThreshold ?? 0);
  // minContractToSend: undefined = not set (send all), 0 = send all, >0 = only send if currentPerK >= value
  const resolvedMinContractToSend = minContractToSend !== null ? minContractToSend : existingMercenaryConfig?.minContractToSend;
  // minPayout: undefined = not set (send all), 0 = send all, >0 = only send if budget >= value
  const resolvedMinPayout = minPayout !== null ? minPayout : existingMercenaryConfig?.minPayout;

  // Update configuration
  ServerConfigManager.updateMercenaryContractsConfig(serverId, {
    channelId: newChannelId,
    roleIds: newRoleIds,
    enabled: existingMercenaryConfig?.enabled ?? true, // Default to enabled
    contractThreshold: contractThreshold,
    minContractToSend: resolvedMinContractToSend,
    minPayout: resolvedMinPayout,
  });

  // Initialize Discord channel
  await discordService.initializeServerChannel(serverId, newChannelId);

  // Build confirmation message
  let confirmationMessage = `✅ **Mercenary contract notifications configured:**\n\n`;
  confirmationMessage += `📢 **Channel:** <#${newChannelId}>\n`;
  confirmationMessage += `💰 **Contract Threshold:** ${contractThreshold} gold per 1k damage\n`;
  
  const minDisplay = resolvedMinContractToSend !== undefined && resolvedMinContractToSend !== null
    ? (resolvedMinContractToSend === 0 ? '0 (send all)' : `${resolvedMinContractToSend} gold per 1k damage`)
    : 'None (send all)';
  confirmationMessage += `📊 **Min contract to send:** ${minDisplay}\n`;

  const minPayoutDisplay = resolvedMinPayout !== undefined && resolvedMinPayout !== null
    ? (resolvedMinPayout === 0 ? '0 (send all)' : `${resolvedMinPayout} gold`)
    : 'None (send all)';
  confirmationMessage += `💼 **Min payout to send:** ${minPayoutDisplay}\n`;

  const roleMentions = newRoleIds.length > 0
    ? newRoleIds.map(id => `<@&${id}>`).join(', ')
    : 'None';
  confirmationMessage += `🏷️ **Roles:** ${roleMentions}\n`;
  confirmationMessage += `✅ **Status:** Enabled`;

  await interaction.reply({
    content: confirmationMessage,
    ephemeral: true
  });
}

/**
 * Handle /contracts config view command
 */
async function handleConfigView(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guild!.id;
  const serverConfig = ServerConfigManager.getServerConfig(serverId);
  const mercenaryConfig = serverConfig?.mercenaryContracts;

  if (!mercenaryConfig) {
    await interaction.reply({
      content: '❌ **Mercenary contract notifications are not configured for this server.**\n\n' +
               'Use `/contracts config set` to configure notifications.',
      ephemeral: true
    });
    return;
  }

  const channelMention = `<#${mercenaryConfig.channelId}>`;
  const roleMentions = mercenaryConfig.roleIds?.length > 0 
    ? mercenaryConfig.roleIds.map(id => `<@&${id}>`).join(', ')
    : 'None';
  const status = mercenaryConfig.enabled !== false ? '✅ Enabled' : '❌ Disabled';
  const contractThreshold = mercenaryConfig.contractThreshold ?? 0;
  
  const minDisplay = mercenaryConfig.minContractToSend !== undefined && mercenaryConfig.minContractToSend !== null
    ? (mercenaryConfig.minContractToSend === 0 ? '0 (send all)' : `${mercenaryConfig.minContractToSend} gold per 1k damage`)
    : 'None (send all)';

  const minPayoutDisplay = mercenaryConfig.minPayout !== undefined && mercenaryConfig.minPayout !== null
    ? (mercenaryConfig.minPayout === 0 ? '0 (send all)' : `${mercenaryConfig.minPayout} gold`)
    : 'None (send all)';

  await interaction.reply({
    content: `📋 **Mercenary Contract Notification Settings:**\n\n` +
             `📢 **Channel:** ${channelMention}\n` +
             `🏷️ **Roles:** ${roleMentions}\n` +
             `💰 **Contract Threshold:** ${contractThreshold} gold per 1k damage\n` +
             `📊 **Min contract to send:** ${minDisplay}\n` +
             `💼 **Min payout to send:** ${minPayoutDisplay}\n` +
             `📊 **Status:** ${status}`,
    ephemeral: true
  });
}

/**
 * Handle /contracts enable command
 */
async function handleEnable(interaction: ChatInputCommandInteraction, _discordService: DiscordService): Promise<void> {
  const serverId = interaction.guild!.id;
  const serverConfig = ServerConfigManager.getServerConfig(serverId);
  const mercenaryConfig = serverConfig?.mercenaryContracts;

  if (!mercenaryConfig) {
    await interaction.reply({
      content: '❌ **Mercenary contract notifications are not configured for this server.**\n\n' +
               'Use `/contracts config set` to configure notifications first.',
      ephemeral: true
    });
    return;
  }

  // Update configuration to enabled
  ServerConfigManager.updateMercenaryContractsConfig(serverId, {
    ...mercenaryConfig,
    enabled: true
  });

  await interaction.reply({
    content: '✅ **Mercenary contract notifications enabled** for this server.',
    ephemeral: true
  });
}

/**
 * Handle /contracts disable command
 */
async function handleDisable(interaction: ChatInputCommandInteraction, _discordService: DiscordService): Promise<void> {
  const serverId = interaction.guild!.id;
  const serverConfig = ServerConfigManager.getServerConfig(serverId);
  const mercenaryConfig = serverConfig?.mercenaryContracts;

  if (!mercenaryConfig) {
    await interaction.reply({
      content: '❌ **Mercenary contract notifications are not configured for this server.**\n\n' +
               'Use `/contracts config set` to configure notifications first.',
      ephemeral: true
    });
    return;
  }

  // Update configuration to disabled
  ServerConfigManager.updateMercenaryContractsConfig(serverId, {
    ...mercenaryConfig,
    enabled: false
  });

  await interaction.reply({
    content: '❌ **Mercenary contract notifications disabled** for this server.',
    ephemeral: true
  });
}