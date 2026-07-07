import { APIClient } from 'warera-sdk';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';
import { ProxyUser, TrackedProxyCountry } from '../../config/config';

/**
 * Service for tracking proxy users who move between countries and monitoring their cooldowns
 */
export class ProxyTrackingService {
  private apiClient: APIClient;
  // @ts-ignore - DiscordService kept for future notification functionality
  private _discordService: DiscordService; // Prefixed with _ since notifications are disabled
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 5 * 1000; // 5 minutes (same as country tracking)

  constructor(apiClient: APIClient, discordService: DiscordService, _apiService: ApiService) {
    this.apiClient = apiClient;
    this._discordService = discordService;
  }

  /**
   * Start the proxy tracking service with 5-minute polling
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Proxy tracking service is already running');
      return;
    }

    logger.info('Starting proxy tracking service (checks every 5 minutes)');

    // Run immediately on start
    this.checkAllTrackedCountries();

    // Then run every 5 minutes
    this.intervalId = setInterval(() => {
      this.checkAllTrackedCountries();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the proxy tracking service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Proxy tracking service stopped');
    }
  }

  /**
   * Check all tracked countries for proxy movements across all servers
   */
  private async checkAllTrackedCountries(): Promise<void> {
    try {
      const serverConfigs = ServerConfigManager.readServerConfigs();
      
      for (const [serverId, config] of serverConfigs.entries()) {
        // Skip if proxy tracking is not enabled or configured
        if (!config.proxyTracking || config.proxyTracking.enabled === false) {
          continue;
        }

        const trackedCountries = config.proxyTracking.countries;
        
        if (trackedCountries.length === 0) {
          continue;
        }

        logger.debug(`Checking ${trackedCountries.length} tracked proxy country(ies) for server ${serverId}`);

        for (const trackedCountry of trackedCountries) {
          if (trackedCountry.enabled) {
            await this.checkCountryForProxies(serverId, trackedCountry);
          }
        }
      }
    } catch (error) {
      logger.error('Error checking tracked countries for proxies', error);
    }
  }

  /**
   * Check a single country for user movements (proxies leaving)
   */
  private async checkCountryForProxies(serverId: string, trackedCountry: TrackedProxyCountry): Promise<void> {
    try {
      logger.debug(`Checking country ${trackedCountry.countryName} (${trackedCountry.countryId}) for proxy movements`);

      // Get current users in the country
      const currentUsers = await this.getCurrentCountryUsers(trackedCountry.countryId);
      const currentUserIds = new Set(currentUsers.map(user => user._id));

      // Get stored state (either initialUsers or previous check)
      const storedUsers = trackedCountry.initialUsers || [];

      // Find users who have left this country
      const leftUsers = storedUsers.filter(userId => !currentUserIds.has(userId));

      if (leftUsers.length > 0) {
        logger.info(`Found ${leftUsers.length} user(s) who left ${trackedCountry.countryName}`);
        
        // Check each user who left to see where they went
        for (const userId of leftUsers) {
          await this.handleUserMovement(serverId, trackedCountry, userId);
        }
      }

      // Update the stored user list for this country (current becomes the new baseline)
      const now = new Date();
      ServerConfigManager.updateTrackedProxyCountry(
        serverId,
        trackedCountry.countryId,
        now.toISOString(),
        Array.from(currentUserIds)
      );

    } catch (error) {
      logger.error(`Error checking country ${trackedCountry.countryName} for proxies:`, error);
    }
  }

  /**
   * Get all current users in a country
   */
  private async getCurrentCountryUsers(countryId: string): Promise<Array<{ _id: string; createdAt: string }>> {
    const allUsers: Array<{ _id: string; createdAt: string }> = [];
    let cursor: string | null = null;

    try {
      do {
        const response = await this.apiClient.user.getUsersByCountry({
          countryId,
          cursor: cursor || undefined,
          limit: 100
        });

        const users = response.result.data.items;
        allUsers.push(...users);
        cursor = response.result.data.nextCursor;

      } while (cursor);

      return allUsers;
    } catch (error) {
      logger.error(`Error fetching users for country ${countryId}:`, error);
      return [];
    }
  }

  /**
   * Handle a user who has moved from a tracked country
   */
  private async handleUserMovement(serverId: string, originalCountry: TrackedProxyCountry, userId: string): Promise<void> {
    try {
      // Get user details to find their new country
      const userResponse = await this.apiClient.user.getUserLite(userId);
      const userData = userResponse.result.data;

      // Check if they actually moved to a different country
      if (userData.country === originalCountry.countryId) {
        // User is still in the same country (might be API inconsistency), skip
        logger.debug(`User ${userId} appears to still be in ${originalCountry.countryName}, skipping`);
        return;
      }

      // Get the new country details
      const newCountryResponse = await this.apiClient.country.getCountryById(userData.country);
      const newCountryData = newCountryResponse.result.data;

      // Create proxy record
      const proxyUser: ProxyUser = {
        userId: userId,
        username: userData.username,
        originalCountryId: originalCountry.countryId,
        originalCountryName: originalCountry.countryName,
        proxyCountryId: userData.country,
        proxyCountryName: newCountryData.name,
        detectedAt: new Date().toISOString(),
        lastCitizenshipChangeAt: userData.dates.lastCitizenshipChangeAt,
        manuallyAdded: false
      };

      // Add to server config
      ServerConfigManager.addProxyUser(serverId, proxyUser);

      // Send notification (disabled for now - users can interact via commands)
      // await this.sendProxyDetectionNotification(serverId, originalCountry, proxyUser);

      logger.info(`Detected proxy: ${userData.username} (${userId}) moved from ${originalCountry.countryName} to ${newCountryData.name}`);

    } catch (error) {
      logger.error(`Error handling user movement for user ${userId}:`, error);
    }
  }

  /**
   * Send notification when a proxy is detected
   */
  // private async sendProxyDetectionNotification(_serverId: string, originalCountry: TrackedProxyCountry, proxyUser: ProxyUser): Promise<void> {
  //   try {
  //     const cooldownDays = this.calculateCooldownRemaining(proxyUser.lastCitizenshipChangeAt);
  //     const cooldownText = cooldownDays > 0 ? `${cooldownDays} days remaining` : 'Ready to move';

  //     let message = `🚨 **Proxy Movement Detected**\n\n`;
  //     message += `**User:** ${proxyUser.username} (${proxyUser.userId})\n`;
  //     message += `**Movement:** ${proxyUser.originalCountryName} → ${proxyUser.proxyCountryName}\n`;
  //     message += `**Cooldown:** ${cooldownText}\n`;
  //     message += `**Detected:** <t:${Math.floor(new Date(proxyUser.detectedAt).getTime() / 1000)}:F>`;

  //     // Add mentions if configured
  //     if (originalCountry.mentionIds && originalCountry.mentionIds.length > 0) {
  //       message += `\n\n${originalCountry.mentionIds.join(' ')}`;
  //     }

  //     await this._discordService.sendMessage(originalCountry.channelId, message);

  //   } catch (error) {
  //     logger.error('Error sending proxy detection notification:', error);
  //   }
  // }

  /**
   * Calculate remaining cooldown days for citizenship change
   */
  private calculateCooldownRemaining(lastCitizenshipChangeAt: string): number {
    const lastChange = new Date(lastCitizenshipChangeAt);
    const cooldownEnd = new Date(lastChange.getTime() + (30 * 24 * 60 * 60 * 1000));
    const now = new Date();
    return Math.max(0, Math.ceil((cooldownEnd.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
  }

  /**
   * Get all proxies for a server with their current cooldown status
   */
  public getProxiesWithCooldown(serverId: string): Array<ProxyUser & { cooldownDays: number }> {
    const serverConfigs = ServerConfigManager.readServerConfigs();
    const config = serverConfigs.get(serverId);
    
    if (!config?.proxyTracking?.proxies) {
      return [];
    }

    return config.proxyTracking.proxies.map(proxy => ({
      ...proxy,
      cooldownDays: this.calculateCooldownRemaining(proxy.lastCitizenshipChangeAt)
    }));
  }

  /**
   * Initialize tracking for a country by storing current users as baseline
   */
  public async initializeCountryTracking(countryId: string): Promise<string[]> {
    try {
      const currentUsers = await this.getCurrentCountryUsers(countryId);
      const userIds = currentUsers.map(user => user._id);
      
      logger.info(`Initialized proxy tracking for country ${countryId} with ${userIds.length} users`);
      return userIds;
      
    } catch (error) {
      logger.error(`Error initializing country tracking for ${countryId}:`, error);
      throw error;
    }
  }
}