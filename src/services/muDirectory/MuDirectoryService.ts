import { GetUserLiteResponse, MuDTO } from 'warera-sdk';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';
import { ScheduledTask } from '../scheduler/ScheduledTask';
import { MuDirectoryConfig } from '../../config/config';
import { computeDamagePotential } from './damage';
import { computeMuScore } from './score';
import { renderDirectory, MuDirectoryEntry } from './render';
import { buildMuUrl } from './muLink';

// Domain types re-exported so command handlers never import the SDK directly.
type UserDTO = NonNullable<GetUserLiteResponse['result']['data']>;
export type MuDirectoryMu = MuDTO;
export type MuDirectoryUser = UserDTO;

const BATCH_SIZE = 100;

/** UTC hour at which the daily directory refresh runs (mirrors the original bot's default). */
const REFRESH_HOUR_UTC = 12;

function getNextDailyRefresh(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setUTCHours(REFRESH_HOUR_UTC, 0, 0, 0);
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * Maintains a per-server WarEra Military-Unit directory: a curated list of MUs
 * rendered as a living, positionally-edited set of Discord messages, refreshed
 * daily. Ports the original MU-Directory-Python bot onto our SDK, batching, and
 * persistence.
 */
export class MuDirectoryService implements ScheduledTask {
  readonly name = 'mu-directory';
  readonly intervalMs = 24 * 60 * 60 * 1000; // daily

  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(discordService: DiscordService, apiService: ApiService) {
    this.discordService = discordService;
    this.apiService = apiService;
  }

  /** Align the first refresh to the next REFRESH_HOUR_UTC rather than running on boot. */
  initialDelayMs(now: Date): number {
    return getNextDailyRefresh(now).getTime() - now.getTime();
  }

  async runCycle(): Promise<void> {
    await this.refreshAllEnabled();
  }

  private async refreshAllEnabled(): Promise<void> {
    try {
      const serverConfigs = ServerConfigManager.readServerConfigs();
      for (const [serverId, serverConfig] of serverConfigs.entries()) {
        const config = serverConfig.muDirectory;
        if (!config || config.enabled === false || !config.channelId) {
          continue;
        }
        try {
          await this.refreshDirectory(serverId, config);
        } catch (error) {
          logger.error(`Failed to refresh MU directory for server ${serverId}`, error);
        }
      }
    } catch (error) {
      logger.error('Error refreshing MU directories', error);
    }
  }

  /** Refresh a single server's directory now (used by /mudirectory refresh). */
  async refreshServer(serverId: string): Promise<void> {
    const config = ServerConfigManager.getMuDirectoryConfig(serverId);
    if (!config) {
      throw new Error('MU directory is not configured for this server.');
    }
    if (!config.channelId) {
      throw new Error('No channel is configured. Run `/mudirectory setup` first.');
    }
    await this.refreshDirectory(serverId, config);
  }

  private async refreshDirectory(serverId: string, config: MuDirectoryConfig): Promise<void> {
    logger.info(`Refreshing MU directory for server ${serverId}`);

    const militaryUnitIds = ServerConfigManager.getMilitaryUnits(serverId).map(u => u.muId);
    const mus = await this.fetchMilitaryUnits(militaryUnitIds);
    const musById = new Map(mus.map(m => [m._id, m]));

    const userIds = new Set<string>();
    for (const mu of mus) {
      for (const memberId of mu.members ?? []) {
        userIds.add(memberId);
      }
      for (const commanderId of mu.roles?.commanders ?? []) {
        userIds.add(commanderId);
      }
    }
    const users = await this.fetchUsers([...userIds]);

    const entries: MuDirectoryEntry[] = militaryUnitIds.map(muId => {
      const mu = musById.get(muId);
      if (!mu) {
        // API fetch failed for this MU: render a placeholder rather than dropping it.
        return {
          name: `MU ${muId}`,
          url: buildMuUrl(muId),
          hqLevel: 0,
          dormsLevel: 0,
          commanders: [],
          score: 0,
          potentialDamage: 0,
        };
      }

      let potentialDamage = 0;
      for (const memberId of mu.members ?? []) {
        const user = users.get(memberId);
        if (user) {
          potentialDamage += computeDamagePotential(user);
        }
      }

      const commanders = (mu.roles?.commanders ?? []).map(id => users.get(id)?.username ?? id);

      return {
        name: mu.name || `MU ${muId}`,
        url: buildMuUrl(muId),
        hqLevel: mu.activeUpgradeLevels?.headquarters ?? 0,
        dormsLevel: mu.activeUpgradeLevels?.dormitories ?? 0,
        commanders,
        score: computeMuScore(mu),
        potentialDamage,
      };
    });

    const content = renderDirectory(entries);
    const messageIds = await this.discordService.updateDirectoryMessages(
      config.channelId,
      config.messageIds,
      content
    );

    ServerConfigManager.updateMuDirectoryConfig(serverId, {
      messageIds,
      lastUpdated: new Date().toISOString(),
    });

    logger.info(`MU directory updated for server ${serverId} (${entries.length} MUs)`);
  }

  private async fetchMilitaryUnits(muIds: string[]): Promise<MuDTO[]> {
    const mus: MuDTO[] = [];

    for (let i = 0; i < muIds.length; i += BATCH_SIZE) {
      const chunk = muIds.slice(i, i + BATCH_SIZE);
      const batchClient = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id => batchClient.mu.getById(id));

      await batchClient.runBatch();
      const results = await Promise.all(promises);

      for (const result of results) {
        if (result?.result?.data) {
          mus.push(result.result.data);
        }
      }
    }

    return mus;
  }

  private async fetchUsers(userIds: string[]): Promise<Map<string, UserDTO>> {
    const users = new Map<string, UserDTO>();

    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const chunk = userIds.slice(i, i + BATCH_SIZE);
      const batchClient = this.apiService.createCommandBatchClient();
      const promises = chunk.map(id => batchClient.user.getUserLite(id));

      await batchClient.runBatch();
      const results = await Promise.all(promises);

      for (const result of results) {
        const data = result?.result?.data;
        if (data) {
          users.set(data._id, data);
        }
      }
    }

    return users;
  }
}
