import { APIClient } from 'warera-sdk';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';
import { TrackedCountry } from '../../config/config';

/**
 * Service for tracking country activity and sending population/government notifications
 */
export class CountryTrackingService {
  private apiClient: APIClient;
  private discordService: DiscordService;
  private apiService: ApiService;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 5 * 1000; // 5 minutes

  constructor(apiClient: APIClient, discordService: DiscordService, apiService: ApiService) {
    this.apiClient = apiClient;
    this.discordService = discordService;
    this.apiService = apiService;
  }

  /**
   * Start the country tracking service with hourly polling
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Country tracking service is already running');
      return;
    }

    logger.info('Starting country tracking service (checks every hour)');

    // Run immediately on start
    this.checkAllTrackedCountries();

    // Then run every hour
    this.intervalId = setInterval(() => {
      this.checkAllTrackedCountries();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop the country tracking service
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Country tracking service stopped');
    }
  }

  /**
   * Check all tracked countries across all servers
   */
  private async checkAllTrackedCountries(): Promise<void> {
    try {
      const serverConfigs = ServerConfigManager.readServerConfigs();
      
      for (const [serverId, config] of serverConfigs.entries()) {
        // Skip if country tracking is not enabled or configured
        if (!config.countryTracking || config.countryTracking.enabled === false) {
          continue;
        }

        const trackedCountries = config.countryTracking.countries;
        
        if (trackedCountries.length === 0) {
          continue;
        }

        logger.debug(`Checking ${trackedCountries.length} tracked country(ies) for server ${serverId}`);

        for (const trackedCountry of trackedCountries) {
          await this.checkCountry(serverId, trackedCountry);
        }
      }
    } catch (error) {
      logger.error('Error checking tracked countries', error);
    }
  }

  /**
   * Check a single tracked country and send notification if population is low
   */
  private async checkCountry(serverId: string, trackedCountry: TrackedCountry): Promise<void> {
    try {
      // Fetch country data from API
      const response = await this.apiClient.country.getCountryById(trackedCountry.countryId);
      const countryData = response.result.data;
      
      const currentPopulation = countryData.rankings?.countryActivePopulation?.value || 0;
      const now = new Date();
      
      // Check if population has increased (reset warn flag if it has)
      const hasPopulationIncreased = trackedCountry.lastPopulation !== undefined && 
                                   currentPopulation > trackedCountry.lastPopulation &&
                                   currentPopulation >= trackedCountry.populationWarnThreshold;
      
      // If population increased above warn threshold, reset the reported flag
      if (hasPopulationIncreased && trackedCountry.warnReported) {
        logger.info(`Country ${trackedCountry.countryName} population increased from ${trackedCountry.lastPopulation} to ${currentPopulation}`);
        ServerConfigManager.updateTrackedCountryStatus(
          serverId,
          trackedCountry.countryId,
          now.toISOString(),
          currentPopulation,
          false // Reset reported flag
        );
      } else {
        // Just update the check timestamp and population
        ServerConfigManager.updateTrackedCountryStatus(
          serverId,
          trackedCountry.countryId,
          now.toISOString(),
          currentPopulation
        );
      }

      // Check if population is below critical threshold (always alert)
      if (currentPopulation < trackedCountry.populationCriticalThreshold) {
        await this.sendPopulationAlert(
          serverId,
          trackedCountry,
          currentPopulation,
          'critical'
        );
      }
      // Check if population is below warn threshold (alert once)
      else if (currentPopulation < trackedCountry.populationWarnThreshold && !trackedCountry.warnReported) {
        await this.sendPopulationAlert(
          serverId,
          trackedCountry,
          currentPopulation,
          'warn'
        );
        
        // Mark as reported
        ServerConfigManager.updateTrackedCountryStatus(
          serverId,
          trackedCountry.countryId,
          now.toISOString(),
          currentPopulation,
          true // Mark as reported
        );
      }

      logger.debug(
        `Country ${trackedCountry.countryName}: ` +
        `population ${currentPopulation}, warn threshold: ${trackedCountry.populationWarnThreshold}, ` +
        `critical: ${trackedCountry.populationCriticalThreshold}, reported: ${trackedCountry.warnReported || false}`
      );
    } catch (error) {
      logger.error(`Failed to check country ${trackedCountry.countryId} for server ${serverId}`, error);
    }
  }

  /**
   * Send population alert notification to Discord
   */
  private async sendPopulationAlert(
    serverId: string,
    trackedCountry: TrackedCountry,
    currentPopulation: number,
    alertType: 'warn' | 'critical'
  ): Promise<void> {
    try {
      // Build mention string only for critical alerts
      let mentionString = '';
      if (alertType === 'critical' && trackedCountry.mentionIds && trackedCountry.mentionIds.length > 0) {
        mentionString = trackedCountry.mentionIds.join(' ') + ' ';
      }

      const emoji = alertType === 'critical' ? '🚨' : '⚠️';
      const alertTitle = alertType === 'critical' ? 'CRITICAL Population Alert' : 'Warning: Low Population';
      const threshold = alertType === 'critical' ? trackedCountry.populationCriticalThreshold : trackedCountry.populationWarnThreshold;
      
      let message = 
        `${mentionString}**${emoji} ${alertTitle}**\n\n` +
        `Country **${trackedCountry.countryName}** population is **${currentPopulation}**.\n` +
        `Threshold: ${threshold}\n\n`;

      // For warn alerts, get detailed player activity information
      if (alertType === 'warn') {
        try {
          const playersInfo = await this.getCountryPlayersActivity(trackedCountry.countryId);
          if (playersInfo.length > 0) {
            message += `**Government Member Activity (${playersInfo.length} of ${currentPopulation} total citizens):**\n`;
            for (const player of playersInfo) {
              const lastLoginTimestamp = Math.floor(new Date(player.lastLogin).getTime() / 1000);
              message += `${player.username} - Last login: <t:${lastLoginTimestamp}:F>\n`;
            }
          } else {
            message += `**No government members found** (${currentPopulation} total citizens)\n`;
          }
        } catch (error) {
          logger.error(`Failed to get player activity for country ${trackedCountry.countryId}`, error);
          message += `*Unable to retrieve government member activity details*\n`;
        }
      }

      await this.discordService.sendMessageToChannel(serverId, trackedCountry.channelId, message);
      
      logger.info(
        `Sent ${alertType} population alert for country ${trackedCountry.countryId} (${trackedCountry.countryName}) ` +
        `to channel ${trackedCountry.channelId} in server ${serverId}`
      );
    } catch (error) {
      logger.error(
        `Failed to send population alert for country ${trackedCountry.countryId} ` +
        `to channel ${trackedCountry.channelId} in server ${serverId}`,
        error
      );
    }
  }

  /**
   * Get activity information for players in a country
   */
  private async getCountryPlayersActivity(countryId: string): Promise<Array<{
    username: string;
    userId: string;
    lastLogin: string;
  }>> {
    try {
      // Get country government members first
      const govResponse = await this.apiClient.government.getByCountryId(countryId);
      const government = govResponse.result.data;
      
      const playerIds = new Set<string>();
      
      // Add all government members
      if (government.president) playerIds.add(government.president);
      if (government.vicePresident) playerIds.add(government.vicePresident);
      if (government.minOfDefense) playerIds.add(government.minOfDefense);
      if (government.minOfForeignAffairs) playerIds.add(government.minOfForeignAffairs);
      if (government.minOfEconomy) playerIds.add(government.minOfEconomy);
      if (government.congressMembers && Array.isArray(government.congressMembers)) {
        government.congressMembers.forEach(id => playerIds.add(id));
      }

      if (playerIds.size === 0) {
        return [];
      }

      // Batch fetch user data
      const batchClient = this.apiService.createCommandBatchClient();
      const playerIdArray = Array.from(playerIds);
      const userPromises = playerIdArray.map(id => 
        batchClient.user.getUserLite(id)
      );
      
      await batchClient.runBatch();
      const userResults = await Promise.all(userPromises);
      
      const playersInfo: Array<{
        username: string;
        userId: string;
        lastLogin: string;
      }> = [];
      
      for (let i = 0; i < playerIdArray.length; i++) {
        const userResponse = userResults[i];
        if (userResponse?.result?.data) {
          const userData = userResponse.result.data;
          playersInfo.push({
            username: userData.username,
            userId: playerIdArray[i],
            lastLogin: userData.dates.lastConnectionAt
          });
        }
      }
      
      // Sort by last login (most recent first)
      playersInfo.sort((a, b) => new Date(b.lastLogin).getTime() - new Date(a.lastLogin).getTime());
      
      return playersInfo;
    } catch (error) {
      logger.error(`Failed to get country players activity for ${countryId}`, error);
      return [];
    }
  }

  /**
   * Get service status
   */
  isRunning(): boolean {
    return this.intervalId !== null;
  }
}