/**
 * @deprecated This file is part of the legacy message tracking system that has been removed.
 * 
 * The new SimpleBountyTracker system uses a fire-and-forget approach for bounty alerts
 * and does not track or update Discord messages after sending them.
 * 
 * This file is preserved for potential rollback purposes only.
 * DO NOT USE unless reverting to the legacy message tracking system.
 */

import { logger } from '../../utils/logger';

/**
 * @deprecated Legacy tracker for Discord message IDs for each battle per server
 * Maps: serverId -> battleId -> messageId
 * 
 * Not used in the new SimpleBountyTracker system.
 */
export class LegacyMessageTracker {
  private messages: Map<string, Map<string, string>> = new Map(); // serverId -> (battleId -> messageId)

  /**
   * Store a message ID for a battle in a specific server
   */
  setMessageId(serverId: string, battleId: string, messageId: string): void {
    if (!this.messages.has(serverId)) {
      this.messages.set(serverId, new Map());
    }
    this.messages.get(serverId)!.set(battleId, messageId);
    logger.debug(`Tracked message ${messageId} for battle ${battleId} in server ${serverId}`);
  }

  /**
   * Get the message ID for a battle in a specific server
   */
  getMessageId(serverId: string, battleId: string): string | undefined {
    return this.messages.get(serverId)?.get(battleId);
  }

  /**
   * Remove tracking for a battle in a specific server
   */
  removeBattle(serverId: string, battleId: string): void {
    this.messages.get(serverId)?.delete(battleId);
    logger.debug(`Removed tracking for battle ${battleId} in server ${serverId}`);
  }

  /**
   * Get all tracked battles for a server
   */
  getTrackedBattles(serverId: string): string[] {
    return Array.from(this.messages.get(serverId)?.keys() || []);
  }

  /**
   * Clear all tracking for a server
   */
  clearServer(serverId: string): void {
    this.messages.delete(serverId);
    logger.debug(`Cleared all tracking for server ${serverId}`);
  }
}