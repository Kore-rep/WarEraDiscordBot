import type { BattleDTO, BattleOrderDTO } from 'warera-sdk';
import { ApiService, BattlePollData, BattleSideRef, battleSideKey } from '../api/ApiService';
import { DiscordService } from '../discord/DiscordService';
import { ScheduledTask } from '../scheduler/ScheduledTask';
import { ServerConfigManager } from '../../utils/serverConfigManager';
import { BattleOrdersConfig } from '../../config/config';
import { logger } from '../../utils/logger';
import { TrackedOrder, diffOrders, eventsForServer, formatOrderEvent } from './battleOrderEvents';

/** Server clocks drift; accept orders created slightly before the previous fetch as new. */
const CLOCK_SLACK_MS = 2 * 60 * 1000;

/**
 * Battle orders feed. Each cycle it finds the battle sides on which a tracked
 * country or MU has placed orders (battles list the ordering ids in
 * `countryOrders` / `muOrders`, so untracked battles cost nothing), fetches those
 * orders in batches, diffs against the previous snapshot, and posts new orders,
 * priority changes, and ended orders to each server that tracks the orderer at
 * the right priority level.
 *
 * The snapshot is in memory and shared by all servers. The first cycle after
 * startup only primes it, so a restart never re-announces live orders.
 */
export class BattleOrdersService implements ScheduledTask {
  readonly name = 'battle-orders';
  readonly intervalMs: number;

  private snapshot = new Map<string, TrackedOrder>();
  private lastFetchAt: Date | null = null;

  constructor(
    intervalMinutes: number,
    private readonly apiService: ApiService,
    private readonly discordService: DiscordService
  ) {
    this.intervalMs = intervalMinutes * 60 * 1000;
  }

  async runCycle(): Promise<void> {
    const servers = activeServers();
    const fetchStartedAt = new Date();
    if (servers.length === 0) {
      this.snapshot.clear();
      this.lastFetchAt = fetchStartedAt;
      return;
    }

    const countryIds = new Set(servers.flatMap(([, cfg]) => cfg.countries.map(c => c.countryId)));
    const muIds = new Set(servers.flatMap(([, cfg]) => cfg.mus.map(m => m.muId)));

    const poll = await this.apiService.fetchAllBattles();
    const sides = sidesWithTrackedOrders(poll.battles, countryIds, muIds);
    const ordersBySide = await this.apiService.fetchBattleOrders(sides);
    const current = this.buildSnapshot(poll, sides, ordersBySide, countryIds, muIds);

    const previous = this.snapshot;
    const since = this.lastFetchAt;
    this.snapshot = current;
    this.lastFetchAt = fetchStartedAt;
    if (!since) {
      logger.info(`Battle orders: primed with ${current.size} tracked order(s)`);
      return;
    }

    const events = diffOrders(previous, current, new Date(since.getTime() - CLOCK_SLACK_MS));
    if (events.length === 0) {
      return;
    }
    for (const [serverId, cfg] of servers) {
      const mine = eventsForServer(events, cfg);
      if (mine.length === 0) {
        continue;
      }
      const body = ['**⚔️ Battle orders**', ...mine.map(e => formatOrderEvent(e, cfg))].join('\n');
      const sent = await this.discordService.sendToChannel(cfg.channelId, body, { roleIds: cfg.roleIds });
      if (!sent) {
        logger.warn(`Battle orders: failed to post ${mine.length} event(s) for server ${serverId}`);
      }
    }
  }

  /**
   * Tracked orders for this cycle. A side whose fetch failed keeps its previous
   * orders, so a transient API error never reads as "every order ended".
   */
  private buildSnapshot(
    poll: BattlePollData,
    sides: BattleSideRef[],
    ordersBySide: Map<string, BattleOrderDTO[] | null>,
    countryIds: Set<string>,
    muIds: Set<string>
  ): Map<string, TrackedOrder> {
    const battles = new Map(poll.battles.map(b => [b._id, b]));
    const current = new Map<string, TrackedOrder>();
    for (const ref of sides) {
      const orders = ordersBySide.get(battleSideKey(ref));
      if (!orders) {
        for (const order of this.snapshot.values()) {
          if (order.battleId === ref.battleId && order.side === ref.side) {
            current.set(order.id, order);
          }
        }
        continue;
      }
      const battleLabel = describeBattle(battles.get(ref.battleId), poll);
      for (const o of orders) {
        const tracked = (o.country && countryIds.has(o.country)) || (o.mu && muIds.has(o.mu));
        if (!tracked || !o.isActive) {
          continue;
        }
        current.set(o._id, {
          id: o._id,
          battleId: o.battle,
          side: o.side,
          priority: o.priority,
          countryId: o.country,
          muId: o.mu,
          text: o.text ?? '',
          createdAt: o.createdAt,
          battleLabel,
        });
      }
    }
    return current;
  }
}

/** Servers with a usable feed: enabled, a channel, and at least one orderer and level. */
function activeServers(): Array<[string, BattleOrdersConfig]> {
  const out: Array<[string, BattleOrdersConfig]> = [];
  for (const [serverId, config] of ServerConfigManager.readServerConfigs()) {
    const cfg = config.battleOrders;
    if (cfg?.enabled && cfg.channelId && cfg.priorities.length > 0 && (cfg.countries.length > 0 || cfg.mus.length > 0)) {
      out.push([serverId, cfg]);
    }
  }
  return out;
}

/** Battle sides on which any tracked country or MU currently has an order. */
export function sidesWithTrackedOrders(
  battles: BattleDTO[],
  countryIds: Set<string>,
  muIds: Set<string>
): BattleSideRef[] {
  const sides: BattleSideRef[] = [];
  for (const battle of battles) {
    for (const side of ['attacker', 'defender'] as const) {
      const data = battle[side];
      const hit =
        (data?.countryOrders ?? []).some(id => countryIds.has(id)) || (data?.muOrders ?? []).some(id => muIds.has(id));
      if (hit) {
        sides.push({ battleId: battle._id, side });
      }
    }
  }
  return sides;
}

function describeBattle(battle: BattleDTO | undefined, poll: BattlePollData): string {
  if (!battle) {
    return 'Battle';
  }
  const region = poll.regions.get(battle.defender.region)?.name ?? poll.regions.get(battle.attacker.region)?.name;
  const attacker = poll.countries.get(battle.attacker.country)?.name ?? 'Unknown';
  const defender = poll.countries.get(battle.defender.country)?.name ?? 'Unknown';
  return `${region ? `Battle for ${region}` : 'Battle'} (${attacker} vs ${defender})`;
}
