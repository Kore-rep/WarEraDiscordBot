import { SlashCommandBuilder, ChatInputCommandInteraction, ChannelType, InteractionContextType } from 'discord.js';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { TrackedUser } from '../../config/config';
import { logger } from '../../utils/logger';
import { createAPI } from 'warera-sdk';

/**
 * Command builder for /user tracking
 */
export function createCommandBuilder(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild);
}

export const userTrackingCommand = {
  data: createCommandBuilder('user', 'Manage user tracking')
    .addSubcommandGroup(group =>
      group
        .setName('tracking')
        .setDescription('Track user activity')
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Start tracking a user for inactivity')
            .addStringOption(option =>
              option
                .setName('userid')
                .setDescription('The War Era user ID to track')
                .setRequired(true)
            )
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('Channel to send notifications in')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText)
            )
            .addStringOption(option =>
              option
                .setName('mentions')
                .setDescription('Users/roles to mention (separate with spaces, e.g., @user1 @role1)')
                .setRequired(false)
            )
            .addIntegerOption(option =>
              option
                .setName('inactivitydays')
                .setDescription('Days of inactivity before notification (default: 2)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(365)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('remove')
            .setDescription('Stop tracking a user')
            .addStringOption(option =>
              option
                .setName('userid')
                .setDescription('The War Era user ID or username to stop tracking')
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List all tracked users and their status')
        )
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      // Ensure command is used in a guild
      if (!interaction.guildId) {
        await interaction.reply({
          content: 'This command can only be used in a server.',
          ephemeral: true,
        });
        return;
      }

      const subcommandGroup = interaction.options.getSubcommandGroup();
      const subcommand = interaction.options.getSubcommand();

      if (subcommandGroup === 'tracking') {
        if (subcommand === 'add') {
          await handleTrackingAdd(interaction);
        } else if (subcommand === 'remove') {
          await handleTrackingRemove(interaction);
        } else if (subcommand === 'list') {
          await handleTrackingList(interaction);
        }
      }
    } catch (error) {
      logger.error('Error executing user tracking command', error);
      
      if (!interaction.replied) {
        await interaction.reply({
          content: 'An error occurred while processing your request.',
          ephemeral: true,
        });
      }
    }
  },
};

/**
 * Handle /user tracking add
 */
async function handleTrackingAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.options.getString('userid', true);
  const channel = interaction.options.getChannel('channel', true);
  const mentionsString = interaction.options.getString('mentions');
  const inactivityDays = interaction.options.getInteger('inactivitydays') ?? 2;
  const serverId = interaction.guildId!;

  // Validate channel type
  if (channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Please select a text channel.',
      ephemeral: true,
    });
    return;
  }

  // Defer reply since we'll be making an API call
  await interaction.deferReply({ ephemeral: true });

  try {
    // Fetch user data from API to get username and current status
    const apiClient = createAPI({ baseUrl: process.env.API_BASE_URL });
    const apiResponse = await apiClient.user.getUserLite(userId);
    const userData = apiResponse.result.data;
    const username = userData.username;
    const lastConnectionAt = userData.dates.lastConnectionAt;

    // Calculate current inactivity
    const now = new Date();
    const lastConnection = new Date(lastConnectionAt);
    const daysSinceConnection = Math.floor(
      (now.getTime() - lastConnection.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Parse mention IDs from the mentions string - store full mention format
    let mentionIds: string[] | undefined;
    if (mentionsString) {
      // Extract full mentions: <@ID>, <@!ID>, or <@&ID>
      const mentionMatches = mentionsString.matchAll(/<@[!&]?\d+>/g);
      mentionIds = Array.from(mentionMatches, m => m[0]);
      
      if (mentionIds.length === 0) {
        await interaction.editReply({
          content: 'Invalid mention format. Please use Discord mentions (e.g., @user @role).',
        });
        return;
      }
    }

    // Determine if user is already inactive
    const isAlreadyInactive = daysSinceConnection >= inactivityDays;

    // Create tracked user object
    const trackedUser: TrackedUser = {
      userId,
      username,
      channelId: channel.id,
      inactivityDays,
      mentionIds,
      reported: isAlreadyInactive, // Mark as reported if already inactive
      lastChecked: now.toISOString(),
      lastActive: lastConnectionAt,
    };

    // Add to config
    ServerConfigManager.addTrackedUser(serverId, trackedUser);

    // If user is already inactive, send immediate notification
    if (isAlreadyInactive) {
      try {
        // Build mention string if mentionIds are configured
        let mentionString = '';
        if (mentionIds && mentionIds.length > 0) {
          mentionString = mentionIds.join(' ') + ' ';
        }

        const notificationMessage = 
          `${mentionString}**User Inactivity Alert**\n\n` +
          `User **${username}** (ID: \`${userId}\`) has been inactive.\n\n` +
          `- Last connection: <t:${Math.floor(lastConnection.getTime() / 1000)}:R> ` +
          `(${daysSinceConnection} day${daysSinceConnection !== 1 ? 's' : ''} ago)\n` +
          `- Inactivity threshold: ${inactivityDays} day${inactivityDays !== 1 ? 's' : ''}\n\n` +
          `This user may need attention or follow-up.`;

        // Send notification to the configured channel
        const notificationChannel = await interaction.client.channels.fetch(channel.id);
        if (notificationChannel && 'send' in notificationChannel) {
          await notificationChannel.send(notificationMessage);
          logger.info(`Sent immediate inactivity notification for user ${userId} (${username}) to channel ${channel.id}`);
        }
      } catch (error) {
        logger.error(`Failed to send immediate inactivity notification for user ${userId}`, error);
      }
    }

    // Build response message with current status
    let replyMessage = `Started tracking user **${username}** (\`${userId}\`).\n\n`;
    replyMessage += `**Configuration:**\n`;
    replyMessage += `- Notification channel: <#${channel.id}>\n`;
    replyMessage += `- Inactivity threshold: ${inactivityDays} day(s)\n`;
    
    if (mentionIds && mentionIds.length > 0) {
      const mentions = mentionIds.join(' ');
      replyMessage += `- Will mention: ${mentions}\n`;
    }
    
    replyMessage += `\n**Current Status:**\n`;
    replyMessage += `- Last active: <t:${Math.floor(lastConnection.getTime() / 1000)}:R> `;
    replyMessage += `(${daysSinceConnection} day${daysSinceConnection !== 1 ? 's' : ''} ago)\n`;
    
    if (isAlreadyInactive) {
      replyMessage += `\n⚠️ **This user is currently inactive!** A notification has been sent to <#${channel.id}>.`;
    } else {
      const daysUntilInactive = inactivityDays - daysSinceConnection;
      replyMessage += `\n✅ User is currently active. You'll be notified if inactive for ${daysUntilInactive} more day${daysUntilInactive !== 1 ? 's' : ''}.`;
    }

    await interaction.editReply({ content: replyMessage });
    logger.info(`User tracking added: ${username} (${userId}) in server ${serverId}`);
  } catch (error) {
    logger.error(`Failed to add user tracking for ${userId}`, error);
    await interaction.editReply({
      content: `Failed to fetch user data for ID \`${userId}\`. Please verify the user ID is correct.`,
    });
  }
}

/**
 * Handle /user tracking remove
 */
async function handleTrackingRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const userIdOrUsername = interaction.options.getString('userid', true);
  const serverId = interaction.guildId!;

  // Try to find user by ID or username
  const trackedUsers = ServerConfigManager.getTrackedUsers(serverId);
  const userToRemove = trackedUsers.find(
    u => u.userId === userIdOrUsername || u.username.toLowerCase() === userIdOrUsername.toLowerCase()
  );

  if (!userToRemove) {
    await interaction.reply({
      content: `User \`${userIdOrUsername}\` is not currently being tracked.`,
      ephemeral: true,
    });
    return;
  }

  const removed = ServerConfigManager.removeTrackedUser(serverId, userToRemove.userId);

  if (removed) {
    await interaction.reply({
      content: `Stopped tracking user **${userToRemove.username}** (\`${userToRemove.userId}\`).`,
      ephemeral: true,
    });
    logger.info(`User tracking removed: ${userToRemove.username} (${userToRemove.userId}) from server ${serverId}`);
  } else {
    await interaction.reply({
      content: `Failed to remove user \`${userIdOrUsername}\` from tracking.`,
      ephemeral: true,
    });
  }
}

/**
 * Handle /user tracking list
 */
async function handleTrackingList(interaction: ChatInputCommandInteraction): Promise<void> {
  const serverId = interaction.guildId!;
  const trackedUsers = ServerConfigManager.getTrackedUsers(serverId);

  if (trackedUsers.length === 0) {
    await interaction.reply({
      content: 'No users are currently being tracked.\n\nUse `/user tracking add` to start tracking a user.',
      ephemeral: true,
    });
    return;
  }

  // Build list message
  let message = '**Tracked Users**\n\n';
  
  for (const user of trackedUsers) {
    message += `**${user.username}** (\`${user.userId}\`)\n`;
    message += `- Channel: <#${user.channelId}>\n`;
    message += `- Inactivity threshold: ${user.inactivityDays} day(s)\n`;
    
    if (user.mentionIds && user.mentionIds.length > 0) {
      const mentions = user.mentionIds.join(' ');
      message += `- Mentions: ${mentions}\n`;
    }
    
    if (user.lastChecked) {
      const lastCheckedDate = new Date(user.lastChecked);
      message += `- Last checked: <t:${Math.floor(lastCheckedDate.getTime() / 1000)}:R>\n`;
    }
    
    if (user.lastActive) {
      const lastActiveDate = new Date(user.lastActive);
      const now = new Date();
      const daysSinceActive = Math.floor(
        (now.getTime() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      message += `- Last active: <t:${Math.floor(lastActiveDate.getTime() / 1000)}:R>`;
      message += ` (${daysSinceActive} day${daysSinceActive !== 1 ? 's' : ''} ago)`;
      
      if (daysSinceActive >= user.inactivityDays) {
        message += ` ⚠️ **INACTIVE**`;
      } else {
        message += ` ✅`;
      }
      message += '\n';
    } else {
      message += `- Last active: Never checked\n`;
    }
    
    message += '\n';
  }

  await interaction.reply({
    content: message,
    ephemeral: true,
  });
}
