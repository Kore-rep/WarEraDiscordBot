import { logger } from '../../utils/logger';
import { BattleTracker, BattleChange } from './BattleTracker';
import { BattleFormatter } from './BattleFormatter';
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';

/**
 * Service that handles all battle-related operations
 * Orchestrates battle tracking, formatting, and Discord updates
 */
export class BattleService {
  private battleTracker: BattleTracker;
  private battleFormatter: BattleFormatter;
  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(
    discordService: DiscordService,
    apiService: ApiService
  ) {
    this.discordService = discordService;
    this.apiService = apiService;
    this.battleTracker = new BattleTracker();
    this.battleFormatter = new BattleFormatter();
  }

  /**
   * Process battles from API - detect changes and update Discord messages
   */
  async processBattles(): Promise<void> {
    try {
      logger.debug('Processing battles...');

      // Fetch data from API (battles, countries, and regions)
      const { battles: allBattles, countries, regions } = await this.apiService.fetchBattles();
      logger.debug(`Fetched ${allBattles.length} battle(s) from API`);

      // Detect changes (new battles, pool increases, pool depletions, or changed moneyPer1kDamages)
      // Note: normal pool decreases trigger message updates but are not logged (only increases and depletions are logged)
      const battleChanges = this.battleTracker.detectChanges(allBattles);

      if (battleChanges.length === 0) {
        logger.debug(`No changes detected. Tracking ${this.battleTracker.getTrackedBattleCount()} battle(s)`);
        return;
      }

      logger.info(
        `Detected ${battleChanges.length} changed battle(s) ` +
        `(new, pool increases/depletions, or changed moneyPer1kDamages)`
      );

      // Extract role IDs per server from changed battles
      const roleIdsByServer = this.apiService.extractRoleIdsByServer(battleChanges.map(bc => bc.battle));

      // Update battle messages for each configured server
      await this.updateBattleMessages(battleChanges, roleIdsByServer, countries, regions);

      logger.debug('Battle processing completed successfully');
    } catch (error) {
      logger.error('Failed to process battles', error);
      throw error;
    }
  }

  /**
   * Update Discord messages for all changed battles across servers
   */
  private async updateBattleMessages(
    battleChanges: BattleChange[],
    roleIdsByServer: Map<string, string[]>,
    countries: Map<string, unknown>,
    regions: Map<string, unknown>
  ): Promise<void> {
    let serversUpdated = 0;

    for (const [serverId, roleIds] of roleIdsByServer.entries()) {
      try {
        // Update each changed battle
        for (const battleChange of battleChanges) {
          logger.info(`Updating battle message for battle ${battleChange.battle._id} in server ${serverId}`);
          
          // Format the battle message
          const battleMessage = this.battleFormatter.formatBattleMessage(
            battleChange.battle,
            countries,
            regions,
            battleChange.changeType,
            battleChange.changeHistory
          );

          // Update the message in Discord
          await this.discordService.updateBattleMessage(
            serverId,
            roleIds,
            battleChange.battle._id,
            battleMessage
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
      logger.info(`Updated battle messages for ${serversUpdated} server(s) for ${battleChanges.length} changed battle(s)`);
    }
  }

  /**
   * Clean up messages for battles that ended more than a day ago
   */
  async cleanupOldBattles(): Promise<void> {
    try {
      logger.debug('Running cleanup for old battles...');
      
      // Get all current battles to check which ones are still active
      const { battles: allBattles } = await this.apiService.fetchBattles();
      
      // Get battles that ended more than a day ago
      const oldBattleIds = this.battleTracker.getOldBattles(allBattles);
      
      if (oldBattleIds.length === 0) {
        logger.debug('No old battles to clean up');
        return;
      }

      logger.info(`Cleaning up ${oldBattleIds.length} old battle(s)...`);

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

      logger.info(`Cleanup completed for ${oldBattleIds.length} old battle(s)`);
    } catch (error) {
      logger.error('Failed to cleanup old battles', error);
    }
  }

  /**
   * Get the number of currently tracked battles
   */
  getTrackedBattleCount(): number {
    return this.battleTracker.getTrackedBattleCount();
  }
}

