import { GetUserLiteResponse, MuDTO } from 'warera-sdk';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { DiscordService } from '../discord/DiscordService';
import { ApiService } from '../api/ApiService';
import { logger } from '../../utils/logger';
import {
  LeaderboardConfig,
  LeaderboardRankEntry,
  LeaderboardSnapshot,
} from '../../config/config';
import {
  buildLeaderboardPayload,
  userMatchesBracket,
} from './leaderboardFormatter';
import {
  buildMuWeeklyDamageCsv,
  buildUserWeeklyDamageCsv,
  getCurrentWeekEndingDate,
  writeWeeklySnapshot,
} from './weeklyDamageSnapshotStore';
import { ScheduledTask } from '../scheduler/ScheduledTask';

const USER_BATCH_SIZE = 100;

type UserDTO = NonNullable<GetUserLiteResponse['result']['data']>;

function rankingValue(entry: { value?: number } | undefined): number {
  return entry?.value ?? 0;
}

function getNextHourlyRefresh(from: Date = new Date()): Date {
  const next = new Date(from);
  next.setMinutes(1, 0, 0);
  if (next <= from) {
    next.setHours(next.getHours() + 1);
  }
  return next;
}

function rankEntries<T>(
  items: T[],
  getValue: (item: T) => number,
  getId: (item: T) => string,
  getName: (item: T) => string,
  limit?: number,
  getCountryCode?: (item: T) => string | undefined,
  getLevel?: (item: T) => number | undefined
): LeaderboardRankEntry[] {
  const sorted = [...items].sort((a, b) => getValue(b) - getValue(a));
  const selected = limit !== undefined ? sorted.slice(0, limit) : sorted;

  return selected.map(item => ({
    id: getId(item),
    name: getName(item),
    value: getValue(item),
    ...(getCountryCode ? { countryCode: getCountryCode(item) } : {}),
    ...(getLevel ? { level: getLevel(item) } : {}),
  }));
}

function topEntries<T>(
  items: T[],
  getValue: (item: T) => number,
  getId: (item: T) => string,
  getName: (item: T) => string,
  limit: number,
  getCountryCode?: (item: T) => string | undefined,
  getLevel?: (item: T) => number | undefined
): LeaderboardRankEntry[] {
  return rankEntries(items, getValue, getId, getName, limit, getCountryCode, getLevel);
}

/**
 * Hourly leaderboard refresh (aligned to :01 past each hour) with living Discord
 * message updates and weekly damage CSV snapshots.
 */
export class LeaderboardService implements ScheduledTask {
  readonly name = 'leaderboard';
  readonly intervalMs = 60 * 60 * 1000; // 1 hour

  private discordService: DiscordService;
  private apiService: ApiService;

  constructor(discordService: DiscordService, apiService: ApiService) {
    this.discordService = discordService;
    this.apiService = apiService;
  }

  /** Align the first refresh to the next :01 past the hour. */
  initialDelayMs(now: Date): number {
    return getNextHourlyRefresh(now).getTime() - now.getTime();
  }

  async runCycle(): Promise<void> {
    await this.refreshAllEnabled();
  }

  async refreshServer(serverId: string): Promise<void> {
    const config = ServerConfigManager.getServerConfig(serverId)?.leaderboard;
    if (!config) {
      throw new Error('Leaderboard is not configured for this server.');
    }
    await this.refreshLeaderboard(serverId, config);
  }

  private async refreshAllEnabled(): Promise<void> {
    try {
      const serverConfigs = ServerConfigManager.readServerConfigs();

      for (const [serverId, serverConfig] of serverConfigs.entries()) {
        const leaderboard = serverConfig.leaderboard;
        if (!leaderboard || leaderboard.enabled === false) {
          continue;
        }

        await this.refreshLeaderboard(serverId, leaderboard);
      }
    } catch (error) {
      logger.error('Error refreshing leaderboards', error);
    }
  }

  private async refreshLeaderboard(serverId: string, config: LeaderboardConfig): Promise<void> {
    try {
      logger.info(`Refreshing leaderboard for server ${serverId}`);

      const muEntries = await this.fetchMilitaryUnits(config.militaryUnitIds);
      const users = await this.fetchUsersForMembers(muEntries);
      const countryCodes = await this.fetchCountryCodes(users.map(user => user.country));

      const getUserCountryCode = (user: UserDTO) => countryCodes.get(user.country);

      const getUserLevel = (user: UserDTO) => user.leveling?.level;

      const playerWeeklyByBracket: Record<string, LeaderboardRankEntry[]> = {};
      for (const bracket of config.levelBrackets) {
        const bracketUsers = users.filter(user =>
          userMatchesBracket(user.leveling?.level ?? 0, bracket)
        );
        playerWeeklyByBracket[bracket.label] = topEntries(
          bracketUsers,
          user => rankingValue(user.rankings?.weeklyUserDamages),
          user => user._id,
          user => user.username,
          config.topCount,
          getUserCountryCode,
          getUserLevel
        );
      }

      const playerTotal = topEntries(
        users,
        user => rankingValue(user.rankings?.userDamages),
        user => user._id,
        user => user.username,
        config.topCount,
        getUserCountryCode,
        getUserLevel
      );

      const muWeekly = topEntries(
        muEntries,
        mu => rankingValue(mu.rankings?.muWeeklyDamages),
        mu => mu._id,
        mu => mu.name,
        config.topCount
      );

      const muTotal = topEntries(
        muEntries,
        mu => rankingValue(mu.rankings?.muDamages),
        mu => mu._id,
        mu => mu.name,
        config.topCount
      );

      const now = new Date();
      const payload = buildLeaderboardPayload({
        playerWeeklyByBracket,
        playerTotal,
        muWeekly,
        muTotal,
        levelBrackets: config.levelBrackets,
        topCount: config.topCount,
        lastSnapshot: config.lastSnapshot,
        updatedAt: now,
        nextRefreshAt: getNextHourlyRefresh(now),
      });

      const messageId = await this.discordService.updateLeaderboardMessage(
        config.channelId,
        config.messageId,
        payload.content,
        payload.embeds
      );

      const snapshot: LeaderboardSnapshot = {
        playerTotal,
        playerWeeklyByBracket,
        muTotal,
        muWeekly,
        capturedAt: now.toISOString(),
      };

      ServerConfigManager.updateLeaderboardConfig(serverId, {
        messageId,
        lastSnapshot: snapshot,
        lastUpdated: now.toISOString(),
      });

      const weeklyUserEntries = rankEntries(
        users,
        user => rankingValue(user.rankings?.weeklyUserDamages),
        user => user._id,
        user => user.username,
        undefined,
        getUserCountryCode,
        getUserLevel
      );
      const weeklyMuEntries = rankEntries(
        muEntries,
        mu => rankingValue(mu.rankings?.muWeeklyDamages),
        mu => mu._id,
        mu => mu.name
      );
      const weekEnding = getCurrentWeekEndingDate(now);
      await writeWeeklySnapshot(
        serverId,
        'users',
        weekEnding,
        buildUserWeeklyDamageCsv(weeklyUserEntries)
      );
      await writeWeeklySnapshot(
        serverId,
        'mu',
        weekEnding,
        buildMuWeeklyDamageCsv(weeklyMuEntries)
      );

      logger.info(
        `Leaderboard updated for server ${serverId} (weekly CSV week ending ${weekEnding}, ${weeklyUserEntries.length} users, ${weeklyMuEntries.length} MUs)`
      );
    } catch (error) {
      logger.error(`Failed to refresh leaderboard for server ${serverId}`, error);
      throw error;
    }
  }

  private async fetchUsersForMembers(mus: MuDTO[]): Promise<UserDTO[]> {
    const userIds = new Set<string>();

    for (const mu of mus) {
      for (const memberId of mu.members ?? []) {
        userIds.add(memberId);
      }
    }

    const allUserIds = Array.from(userIds);
    const users: UserDTO[] = [];

    for (let i = 0; i < allUserIds.length; i += USER_BATCH_SIZE) {
      const chunk = allUserIds.slice(i, i + USER_BATCH_SIZE);
      const batchClient = this.apiService.createCommandBatchClient();
      const userPromises = chunk.map(userId => batchClient.user.getUserLite(userId));

      await batchClient.runBatch();
      const results = await Promise.all(userPromises);

      for (const result of results) {
        if (result?.result?.data) {
          users.push(result.result.data);
        }
      }
    }

    return users;
  }

  private async fetchMilitaryUnits(muIds: string[]): Promise<MuDTO[]> {
    if (muIds.length === 0) {
      return [];
    }

    const batchClient = this.apiService.createCommandBatchClient();
    const muPromises = muIds.map(id => batchClient.mu.getById(id));

    await batchClient.runBatch();
    const results = await Promise.all(muPromises);

    const mus: MuDTO[] = [];

    for (const result of results) {
      if (result?.result?.data) {
        mus.push(result.result.data);
      }
    }

    return mus;
  }

  private async fetchCountryCodes(countryIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(countryIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const batchClient = this.apiService.createCommandBatchClient();
    const countryPromises = uniqueIds.map(countryId =>
      batchClient.country.getCountryById(countryId, { cache: { ttl: 86400 * 1000 } })
    );

    await batchClient.runBatch();
    const results = await Promise.all(countryPromises);

    const codes = new Map<string, string>();
    for (let i = 0; i < uniqueIds.length; i++) {
      const code = results[i]?.result?.data?.code;
      if (code) {
        codes.set(uniqueIds[i], code);
      }
    }

    return codes;
  }
}
