import { logger } from '../../utils/logger';
import { SimpleBountyTracker, NewBounty } from './SimpleBountyTracker';
import { SimpleBattleFormatter } from './SimpleBattleFormatter';
// Legacy imports for rollback capability
import { LegacyBattleTracker, BattleChange } from './LegacyBattleTracker';
import { LegacyBattleFormatter } from './LegacyBattleFormatter';
// Mercenary contract service removed - now handled separately in PollingService
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';
import { ServerConfigManager } from '../../utils/serverConfigManager';

/**
 * Service that handles bounty battle operations only
 * Supports both simplified fire-and-forget system (default) and legacy complex tracking system
 * Use environment variable USE_LEGACY_BATTLE_SYSTEM=true to enable legacy mode for rollback
 * Note: Mercenary contracts are now handled separately by MercenaryContractService
 */
export class BattleService {
  private readonly useSimpleSystem: boolean;
  
  // Simple system components
  private bountyTracker?: SimpleBountyTracker;
  
  // Legacy system components (for rollback capability)
  private legacyBattleTracker?: LegacyBattleTracker;
  private legacyBattleFormatter?: LegacyBattleFormatter;
  private persistedBattleMessagesLoaded = false;
  
  // Common components
  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(
    discordService: DiscordService,
    apiService: ApiService
  ) {
    this.discordService = discordService;
    this.apiService = apiService;
    
    // Check environment variable to determine which system to use for bounties
    this.useSimpleSystem = process.env.USE_LEGACY_BATTLE_SYSTEM?.toLowerCase() !== 'true';
    
    if (this.useSimpleSystem) {
      logger.info('Using simplified bounty tracking system (fire-and-forget)');
      this.bountyTracker = new SimpleBountyTracker();
    } else {
      logger.warn('Using LEGACY battle tracking system - complex message tracking enabled');
      this.legacyBattleTracker = new LegacyBattleTracker();
      this.legacyBattleFormatter = new LegacyBattleFormatter();
    }
  }

  /**
   * Process battles from API - detect changes/new bounties and handle notifications
   * Behavior depends on useSimpleSystem flag
   */
  async processBattles(): Promise<void> {
    if (this.useSimpleSystem) {
      return this.processSimpleBounties();
    } else {
      return this.processLegacyBattles();
    }
  }

  /**
   * Simple system: detect new bounties and send fire-and-forget alerts
   */
  private async processSimpleBounties(): Promise<void> {
    try {
      logger.debug('Processing battles for new bounties (simple system)...');

      // Fetch data from API (battles, countries, and regions)  
      const { battles: allBattles, countries, regions } = await this.apiService.fetchBattles();
      logger.debug(`Fetched ${allBattles.length} battle(s) from API`);

      // Process bounties only
      await this.processBountiesOnly(allBattles, countries, regions);

      logger.debug('Bounty processing completed successfully');
    } catch (error) {
      logger.error('Failed to process bounties', error);
      throw error;
    }
  }

  /**
   * Process bounties only (extracted for parallel processing)
   */
  private async processBountiesOnly(allBattles: any[], countries: Map<string, unknown>, regions: Map<string, unknown>): Promise<void> {
    // Detect new bounties that haven't been alerted for yet
    const newBounties = this.bountyTracker!.detectNewBounties(allBattles);

    if (newBounties.length === 0) {
      logger.debug(`No new bounties detected. Total alerted bounties: ${this.bountyTracker!.getAlertedBountiesCount()}`);
      return;
    }

    logger.info(`Detected ${newBounties.length} new bounty/bounties to alert for`);

    // Send alerts for each new bounty across all configured servers
    await this.sendBountyAlerts(newBounties, countries as Map<string, any>, regions as Map<string, any>);

    // Cleanup old tracking data periodically
    this.bountyTracker!.cleanup();
  }

  /**
   * Legacy system: detect battle changes and update tracked Discord messages
   */
  private async processLegacyBattles(): Promise<void> {
    try {
      logger.debug('Processing battles (legacy system)...');

      // Fetch data from API (battles, countries, and regions)
      const { battles: allBattles, countries, regions } = await this.apiService.fetchBattles();
      logger.debug(`Fetched ${allBattles.length} battle(s) from API`);

      const activeIds = new Set(allBattles.map(b => b._id));
      this.discordService.pruneInactiveBattleTracking(activeIds);

      if (!this.persistedBattleMessagesLoaded) {
        await this.discordService.loadPersistedBattles();
        this.persistedBattleMessagesLoaded = true;
      }

      // Detect changes (new battles, pool increases, pool depletions, or changed moneyPer1kDamages)
      const battleChanges = this.legacyBattleTracker!.detectChanges(allBattles);

      // Process legacy battles only
      await this.processLegacyBattlesOnly(battleChanges, countries, regions);

      logger.debug('Legacy battle processing completed successfully');
    } catch (error) {
      logger.error('Failed to process battles (legacy)', error);
      throw error;
    }
  }

  /**
   * Process legacy battles only (extracted for parallel processing)
   */
  private async processLegacyBattlesOnly(battleChanges: any[], countries: Map<string, unknown>, regions: Map<string, unknown>): Promise<void> {
    if (battleChanges.length === 0) {
      logger.debug(`No changes detected. Tracking ${this.legacyBattleTracker!.getTrackedBattleCount()} battle(s)`);
      return;
    }

    logger.info(`Detected ${battleChanges.length} changed battle(s) (legacy system)`);

    // Extract role IDs per server from changed battles
    const roleIdsByServer = this.apiService.extractRoleIdsByServer(battleChanges.map(bc => bc.battle));

    // Update battle messages for each configured server
    await this.updateLegacyBattleMessages(battleChanges, roleIdsByServer, countries, regions);
  }

  /**
   * Send fire-and-forget bounty alerts to all configured servers
   */
  private async sendBountyAlerts(
    newBounties: NewBounty[],
    countries: Map<string, any>,
    regions: Map<string, any>
  ): Promise<void> {
    // Get all configured servers that have bounty battles enabled
    const configuredServers = this.getConfiguredServers();
    
    if (configuredServers.length === 0) {
      logger.debug('No servers configured for bounty battle notifications');
      return;
    }

    let alertsSent = 0;

    for (const serverId of configuredServers) {
      try {
        const serverConfig = ServerConfigManager.getServerConfig(serverId);
        
        if (!serverConfig?.bountyBattles) {
          continue;
        }

        // Send alert for each new bounty
        for (const newBounty of newBounties) {
          // Check if bounty meets minimum threshold for this server
          const minBountyToSend = serverConfig.bountyBattles.minBountyToSend;
          if (minBountyToSend != null && minBountyToSend > 0 && newBounty.moneyPer1kDamages < minBountyToSend) {
            logger.debug(
              `Skipping bounty for battle ${newBounty.battle._id} in server ${serverId}: bounty ${newBounty.moneyPer1kDamages} below minBountyToSend ${minBountyToSend}`
            );
            continue;
          }

          // Format the bounty alert message
          const alertMessage = SimpleBattleFormatter.formatBountyAlert(newBounty, countries, regions);

          // Determine role mentions based on bounty threshold
          const roleIds = serverConfig.bountyBattles.roleIds || [];
          const bountyThreshold = serverConfig.bountyBattles.bountyThreshold ?? 0;
          const shouldMentionRoles = newBounty.moneyPer1kDamages >= bountyThreshold;
          const effectiveRoleIds = shouldMentionRoles ? roleIds : [];

          logger.info(
            `Sending bounty alert for ${newBounty.country} in battle ${newBounty.battle._id} to server ${serverId} ` +
            `(bounty: ${newBounty.moneyPer1kDamages}, mentions: ${effectiveRoleIds.length > 0})`
          );

          // Send the alert message (fire-and-forget, no tracking)
          await this.discordService.sendBountyAlert(
            serverId,
            alertMessage,
            effectiveRoleIds
          );

          alertsSent++;
        }
      } catch (error) {
        logger.error(`Failed to send bounty alerts for server ${serverId}`, error);
        // Continue with other servers even if one fails
      }
    }

    logger.info(`Sent ${alertsSent} bounty alert(s) across ${configuredServers.length} server(s) for ${newBounties.length} new bounty/bounties`);
  }

  /**
   * Legacy system: update Discord messages for all changed battles across servers  
   */
  private async updateLegacyBattleMessages(
    battleChanges: BattleChange[],
    roleIdsByServer: Map<string, string[]>,
    countries: Map<string, unknown>,
    regions: Map<string, unknown>
  ): Promise<void> {
    let serversUpdated = 0;

    for (const [serverId, roleIds] of roleIdsByServer.entries()) {
      try {
        // Check if notifications are enabled for this server
        const serverConfig = ServerConfigManager.getServerConfig(serverId);
        if (serverConfig?.bountyBattles && serverConfig.bountyBattles.enabled === false) {
          logger.debug(`Skipping server ${serverId} - bounty battle notifications are disabled`);
          continue;
        }

        // Update each changed battle
        for (const battleChange of battleChanges) {
          logger.info(`Updating battle message for battle ${battleChange.battle._id} in server ${serverId} (legacy)`);
          
          // Format the battle message using legacy formatter
          const battleMessage = this.legacyBattleFormatter!.formatBattleMessage(
            battleChange.battle,
            countries,
            regions,
            battleChange.changeType,
            battleChange.changeHistory
          );

          // If pool was replenished, delete the old message and create a new one (to mention roles again)
          if (battleChange.changeType === 'pool_increased') {
            logger.info(`Pool replenished for battle ${battleChange.battle._id}, deleting old message to recreate with mentions`);
            try {
              await this.discordService.deleteBattleMessage(serverId, battleChange.battle._id);
            } catch (error) {
              logger.warn(`Failed to delete message for battle ${battleChange.battle._id}, will create new message anyway`, error);
            }
          }

          // Calculate total bounty for threshold check
          const totalBounty = (battleChange.battle.attacker.moneyPer1kDamages || 0) + 
                             (battleChange.battle.defender.moneyPer1kDamages || 0);

          // If server has minBountyToSend set and bounty is below it, do not send/update message at all
          const minBountyToSend = serverConfig?.bountyBattles?.minBountyToSend;
          if (minBountyToSend != null && minBountyToSend > 0 && totalBounty < minBountyToSend) {
            logger.debug(
              `Skipping battle ${battleChange.battle._id} for server ${serverId}: totalBounty ${totalBounty} below minBountyToSend ${minBountyToSend}`
            );
            continue;
          }

          // Update the message in Discord (will create new if deleted above)
          await this.discordService.updateBattleMessage(
            serverId,
            roleIds,
            battleChange.battle._id,
            battleMessage,
            totalBounty
          );
        }
        serversUpdated++;
      } catch (error) {
        logger.error(`Failed to update battle messages for server ${serverId}`, error);
        // Continue with other servers even if one fails
      }
    }

    if (serversUpdated === 0) {
      logger.debug('No servers configured for battle notifications');
    } else {
      logger.info(`Updated battle messages for ${serversUpdated} server(s) for ${battleChanges.length} changed battle(s) (legacy)`);
    }
  }

  /**
   * Get list of server IDs that have bounty battles configured and enabled
   */
  private getConfiguredServers(): string[] {
    const allConfigs = ServerConfigManager.readServerConfigs();
    return Array.from(allConfigs.keys()).filter(serverId => {
      const config = allConfigs.get(serverId);
      return config?.bountyBattles && 
             config.bountyBattles.enabled !== false && 
             config.bountyBattles.channelId;
    });
  }

  /**
   * Clean up old tracking data based on the system in use
   */
  async cleanupOldBattles(): Promise<void> {
    if (this.useSimpleSystem) {
      return this.cleanupSimpleBounties();
    } else {
      return this.cleanupLegacyBattles();
    }
  }

  /**
   * Simple system: cleanup in-memory bounty tracking data
   */
  private async cleanupSimpleBounties(): Promise<void> {
    try {
      logger.debug('Running cleanup for bounty tracking data...');
      
      // Simple cleanup of in-memory bounty tracking
      this.bountyTracker!.cleanup();
      
      logger.debug('Bounty tracking cleanup completed');
    } catch (error) {
      logger.error('Failed to cleanup bounty tracking data', error);
    }
  }

  /**
   * Legacy system: cleanup messages for battles that ended more than a day ago
   */
  private async cleanupLegacyBattles(): Promise<void> {
    try {
      logger.debug('Running cleanup for old battles (legacy)...');
      
      // Get all current battles to check which ones are still active
      const { battles: allBattles } = await this.apiService.fetchBattles();
      
      // Get battles that ended more than a day ago
      const oldBattleIds = this.legacyBattleTracker!.getOldBattles(allBattles);
      
      if (oldBattleIds.length > 0) {
        logger.info(`Cleaning up ${oldBattleIds.length} old battle(s)...`);
        await this.cleanupBattleMessages(oldBattleIds);
      } else {
        logger.debug('No old battles to clean up');
      }

      logger.info(`Legacy cleanup completed`);
    } catch (error) {
      logger.error('Failed to cleanup old battles (legacy)', error);
    }
  }

  /**
   * Helper method to cleanup battle messages for given battle IDs
   */
  private async cleanupBattleMessages(oldBattleIds: string[]): Promise<void> {
    // Delete messages for old battles in all servers
    const serverIds = this.discordService.getServerIds();
    for (const serverId of serverIds) {
      for (const battleId of oldBattleIds) {
        try {
          await this.discordService.deleteBattleMessage(serverId, battleId);
        } catch (error) {
          logger.warn(`Failed to delete message for battle ${battleId} in server ${serverId}`, error);
        }
      }
    }
    logger.info(`Battle message cleanup completed for ${oldBattleIds.length} old battle(s)`);
  }

  /**
   * Get the number of tracked items (battles or bounties depending on system)
   */
  getTrackedBattleCount(): number {
    if (this.useSimpleSystem) {
      return this.bountyTracker!.getAlertedBountiesCount();
    } else {
      return this.legacyBattleTracker!.getTrackedBattleCount();
    }
  }
}

