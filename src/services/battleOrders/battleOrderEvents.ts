import { BattleOrderPriority, BattleOrdersConfig } from '../../config/config';

/** A battle order the feed is tracking, flattened with a ready-to-print battle label. */
export interface TrackedOrder {
  id: string;
  battleId: string;
  side: 'attacker' | 'defender';
  priority: BattleOrderPriority;
  countryId?: string;
  muId?: string;
  text: string;
  createdAt: string;
  /** e.g. "Battle for Kyiv (Ukraine vs Russia)", captured while the battle was visible. */
  battleLabel: string;
}

export type OrderEvent =
  | { kind: 'new'; order: TrackedOrder }
  | { kind: 'changed'; order: TrackedOrder; previousPriority: BattleOrderPriority }
  | { kind: 'ended'; order: TrackedOrder };

/**
 * Compare two snapshots (keyed by order id). An order missing from `prev` only
 * counts as new when it was created after `since`; older ones were already live
 * when they started being tracked (feed just configured, or after a restart), so
 * announcing them would flood the channel.
 */
export function diffOrders(
  prev: Map<string, TrackedOrder>,
  curr: Map<string, TrackedOrder>,
  since: Date
): OrderEvent[] {
  const events: OrderEvent[] = [];
  for (const order of curr.values()) {
    const before = prev.get(order.id);
    if (!before) {
      if (new Date(order.createdAt).getTime() >= since.getTime()) {
        events.push({ kind: 'new', order });
      }
    } else if (before.priority !== order.priority) {
      events.push({ kind: 'changed', order, previousPriority: before.priority });
    }
  }
  for (const order of prev.values()) {
    if (!curr.has(order.id)) {
      events.push({ kind: 'ended', order });
    }
  }
  return events;
}

/**
 * The events one server should see: placed by a country / MU it tracks and at a
 * priority level it wants. A priority change is shown when either the old or the
 * new level is wanted, so a server watching only "high" hears when an order is
 * raised to or lowered from high.
 */
export function eventsForServer(events: OrderEvent[], cfg: BattleOrdersConfig): OrderEvent[] {
  const countries = new Set(cfg.countries.map(c => c.countryId));
  const mus = new Set(cfg.mus.map(m => m.muId));
  const levels = new Set(cfg.priorities);
  return events.filter(event => {
    const { order } = event;
    const tracked = (order.countryId && countries.has(order.countryId)) || (order.muId && mus.has(order.muId));
    if (!tracked) {
      return false;
    }
    return levels.has(order.priority) || (event.kind === 'changed' && levels.has(event.previousPriority));
  });
}

const PRIORITY_ICON: Record<BattleOrderPriority, string> = { high: '🔴', medium: '🟠', low: '🟡' };

const label = (p: BattleOrderPriority) => p.charAt(0).toUpperCase() + p.slice(1);

function ordererName(order: TrackedOrder, cfg: BattleOrdersConfig): string {
  if (order.muId) {
    return cfg.mus.find(m => m.muId === order.muId)?.muName ?? `MU ${order.muId}`;
  }
  return cfg.countries.find(c => c.countryId === order.countryId)?.countryName ?? 'Unknown country';
}

/** One message line (plus the order text, when the API reveals it) for an event. */
export function formatOrderEvent(event: OrderEvent, cfg: BattleOrdersConfig): string {
  const { order } = event;
  const who = `**${ordererName(order, cfg)}**`;
  const action = order.side === 'attacker' ? 'attack' : 'defend';
  const where = `${order.battleLabel} · <https://app.warera.io/battle/${order.battleId}>`;
  let line: string;
  switch (event.kind) {
    case 'new':
      line = `${PRIORITY_ICON[order.priority]} **${label(order.priority)}** — ${who} orders **${action}** · ${where}`;
      break;
    case 'changed':
      line =
        `${PRIORITY_ICON[order.priority]} ${who} changed its **${action}** order ` +
        `${label(event.previousPriority)} → **${label(order.priority)}** · ${where}`;
      break;
    case 'ended':
      line = `⚪ ${who} order to **${action}** ended (was ${label(order.priority)}) · ${where}`;
      break;
  }
  return order.text && event.kind !== 'ended' ? `${line}\n> ${order.text}` : line;
}
