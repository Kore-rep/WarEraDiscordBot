import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

/**
 * Structure of a battle message entry
 */
export interface BattleMessageEntry {
  serverId: string;
  battleId: string;
  messageId: string;
  timestamp: string;
}

/**
 * Structure of the battles.json file
 */
interface BattlesJsonStructure {
  battles: Record<string, BattleMessageEntry>; // key: "serverId:battleId"
}

/**
 * Manages persisted battle message tracking in battles.json
 * This allows the bot to recover message tracking after restarts
 */
export class BattleMessageTracker {
  private static readonly BATTLES_FILE_PATH = path.join(process.cwd(), '/config/battles.json');

  /**
   * Load all battle messages from battles.json
   * Returns a Map with key "serverId:battleId" -> BattleMessageEntry
   */
  static loadBattles(): Map<string, BattleMessageEntry> {
    if (!fs.existsSync(this.BATTLES_FILE_PATH)) {
      logger.info('battles.json not found, creating empty file');
      this.writeBattlesToDisk(new Map());
      return new Map();
    }

    try {
      const fileContent = fs.readFileSync(this.BATTLES_FILE_PATH, 'utf-8');
      const data = JSON.parse(fileContent) as BattlesJsonStructure;

      const battlesMap = new Map<string, BattleMessageEntry>();
      
      for (const [key, entry] of Object.entries(data.battles || {})) {
        battlesMap.set(key, entry);
      }

      return battlesMap;
    } catch (error) {
      logger.error('Failed to load battles.json', error);
      // Return empty map if file is corrupt
      return new Map();
    }
  }

  /**
   * Save a battle message entry
   */
  static setBattleMessage(serverId: string, battleId: string, messageId: string): void {
    try {
      const battles = this.loadBattles();
      const key = `${serverId}:${battleId}`;
      
      battles.set(key, {
        serverId,
        battleId,
        messageId,
        timestamp: new Date().toISOString(),
      });

      this.writeBattlesToDisk(battles);
      logger.debug(`Persisted battle message ${messageId} for battle ${battleId} in server ${serverId}`);
    } catch (error) {
      logger.error('Failed to persist battle message', error);
      // Don't throw - bot should continue even if persistence fails
    }
  }

  /**
   * Remove a battle message entry
   */
  static removeBattleMessage(serverId: string, battleId: string): void {
    try {
      const battles = this.loadBattles();
      const key = `${serverId}:${battleId}`;
      
      if (battles.delete(key)) {
        this.writeBattlesToDisk(battles);
        logger.debug(`Removed battle message for battle ${battleId} in server ${serverId}`);
      }
    } catch (error) {
      logger.error('Failed to remove battle message from tracking', error);
      // Don't throw
    }
  }

  /**
   * Clear all battle messages for a specific server
   */
  static clearServer(serverId: string): void {
    try {
      const battles = this.loadBattles();
      let removedCount = 0;

      for (const [key, entry] of battles.entries()) {
        if (entry.serverId === serverId) {
          battles.delete(key);
          removedCount++;
        }
      }

      if (removedCount > 0) {
        this.writeBattlesToDisk(battles);
        logger.debug(`Cleared ${removedCount} battle message(s) for server ${serverId}`);
      }
    } catch (error) {
      logger.error('Failed to clear server battle messages', error);
      // Don't throw
    }
  }

  /**
   * Get all battle IDs for a specific server
   */
  static getServerBattles(serverId: string): string[] {
    try {
      const battles = this.loadBattles();
      const battleIds: string[] = [];

      for (const entry of battles.values()) {
        if (entry.serverId === serverId) {
          battleIds.push(entry.battleId);
        }
      }

      return battleIds;
    } catch (error) {
      logger.error('Failed to get server battles', error);
      return [];
    }
  }

  /**
   * Write battles map to disk
   */
  private static writeBattlesToDisk(battles: Map<string, BattleMessageEntry>): void {
    const battlesObject: Record<string, BattleMessageEntry> = {};
    
    for (const [key, entry] of battles.entries()) {
      battlesObject[key] = entry;
    }

    const fileContent: BattlesJsonStructure = {
      battles: battlesObject,
    };

    fs.writeFileSync(
      this.BATTLES_FILE_PATH,
      JSON.stringify(fileContent, null, 2),
      'utf-8'
    );
  }

  /**
   * Clear all battle messages (useful for testing)
   */
  static clearAll(): void {
    try {
      this.writeBattlesToDisk(new Map());
      logger.debug('Cleared all battle messages from battles.json');
    } catch (error) {
      logger.error('Failed to clear all battle messages', error);
    }
  }
}
