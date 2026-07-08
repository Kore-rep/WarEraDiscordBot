import { APIClient } from 'warera-sdk';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { DiscordService } from '../discord/DiscordService';
import { logger } from '../../utils/logger';
import { TrackedUser } from '../../config/config';
import { ScheduledTask } from '../scheduler/ScheduledTask';

/**
 * Tracks user activity and sends inactivity notifications, once per hour.
 */
export class UserTrackingService implements ScheduledTask {
  readonly name = 'user-tracking';
  readonly intervalMs = 60 * 60 * 1000; // 1 hour

  private apiClient: APIClient;
  private discordService: DiscordService;

  constructor(apiClient: APIClient, discordService: DiscordService) {
    this.apiClient = apiClient;
    this.discordService = discordService;
  }

  async runCycle(): Promise<void> {
    await this.checkAllTrackedUsers();
  }

  /**
   * Check all tracked users across all servers
   */
  private async checkAllTrackedUsers(): Promise<void> {
    try {
      const serverConfigs = ServerConfigManager.readServerConfigs();
      
      for (const [serverId, config] of serverConfigs.entries()) {
        // Skip if user tracking is not enabled or configured
        if (!config.userTracking || config.userTracking.enabled === false) {
          continue;
        }

        const trackedUsers = config.userTracking.users;
        
        if (trackedUsers.length === 0) {
          continue;
        }

        logger.debug(`Checking ${trackedUsers.length} tracked user(s) for server ${serverId}`);

        for (const trackedUser of trackedUsers) {
          await this.checkUser(serverId, trackedUser);
        }
      }
    } catch (error) {
      logger.error('Error checking tracked users', error);
    }
  }

  /**
   * Check a single tracked user and send notification if inactive
   */
  private async checkUser(serverId: string, trackedUser: TrackedUser): Promise<void> {
    try {
      // Fetch user data from API
      const response = await this.apiClient.user.getUserLite(trackedUser.userId);
      const userData = response.result.data;
      
      const lastConnectionAt = userData.dates.lastConnectionAt;
      const now = new Date();
      const lastConnection = new Date(lastConnectionAt);
      
      // Calculate days since last connection
      const daysSinceConnection = Math.floor(
        (now.getTime() - lastConnection.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check if user has come back online (lastActive changed)
      const hasReturnedOnline = trackedUser.lastActive && trackedUser.lastActive !== lastConnectionAt;
      
      // If user returned online, reset the reported flag
      if (hasReturnedOnline) {
        logger.info(`User ${trackedUser.userId} (${userData.username}) has returned online`);
        ServerConfigManager.updateTrackedUserStatus(
          serverId,
          trackedUser.userId,
          now.toISOString(),
          lastConnectionAt,
          false // Reset reported flag
        );
      } else {
        // Just update the check timestamp
        ServerConfigManager.updateTrackedUserStatus(
          serverId,
          trackedUser.userId,
          now.toISOString(),
          lastConnectionAt
        );
      }

      // Check if user has been inactive for the threshold period
      if (daysSinceConnection >= trackedUser.inactivityDays) {
        // Only send notification if we haven't reported this inactivity yet
        if (!trackedUser.reported) {
          await this.sendInactivityNotification(
            serverId,
            trackedUser,
            userData.username,
            daysSinceConnection,
            lastConnection
          );
          
          // Mark as reported
          ServerConfigManager.updateTrackedUserStatus(
            serverId,
            trackedUser.userId,
            now.toISOString(),
            lastConnectionAt,
            true // Mark as reported
          );
        } else {
          logger.debug(
            `User ${trackedUser.userId} (${userData.username}) still inactive, ` +
            `already reported (${daysSinceConnection} day(s) ago)`
          );
        }
      }

      logger.debug(
        `User ${trackedUser.userId} (${userData.username}): ` +
        `last active ${daysSinceConnection} day(s) ago, reported: ${trackedUser.reported || false}`
      );
    } catch (error) {
      logger.error(`Failed to check user ${trackedUser.userId} for server ${serverId}`, error);
    }
  }

  /**
   * Send inactivity notification to Discord
   */
  private async sendInactivityNotification(
    serverId: string,
    trackedUser: TrackedUser,
    username: string,
    daysSinceConnection: number,
    lastConnection: Date
  ): Promise<void> {
    try {
      // Build mention string if mentionIds are configured
      // mentionIds already contain full mention format: <@ID> or <@&ID>
      let mentionString = '';
      if (trackedUser.mentionIds && trackedUser.mentionIds.length > 0) {
        mentionString = trackedUser.mentionIds.join(' ') + ' ';
      }

      const message = 
        `${mentionString}**User Inactivity Alert**\n\n` +
        `User **${username}** (ID: \`${trackedUser.userId}\`) has been inactive.\n\n` +
        `- Last connection: <t:${Math.floor(lastConnection.getTime() / 1000)}:F> ` +
        `(${daysSinceConnection} day${daysSinceConnection !== 1 ? 's' : ''} ago)\n` +
        `- Inactivity threshold: ${trackedUser.inactivityDays} day${trackedUser.inactivityDays !== 1 ? 's' : ''}\n\n` +
        `This user may need attention or follow-up.`;

      await this.discordService.sendToChannel(trackedUser.channelId, message);
      
      logger.info(
        `Sent inactivity notification for user ${trackedUser.userId} (${username}) ` +
        `to channel ${trackedUser.channelId} in server ${serverId}`
      );
    } catch (error) {
      logger.error(
        `Failed to send inactivity notification for user ${trackedUser.userId} ` +
        `to channel ${trackedUser.channelId} in server ${serverId}`,
        error
      );
    }
  }
}
