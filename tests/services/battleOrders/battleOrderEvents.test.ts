import { diffOrders, eventsForServer, formatOrderEvent, TrackedOrder } from '../../../src/services/battleOrders/battleOrderEvents';
import { BattleOrdersConfig } from '../../../src/config/config';

const order = (overrides: Partial<TrackedOrder> = {}): TrackedOrder => ({
  id: 'o1',
  battleId: 'b1',
  side: 'attacker',
  priority: 'high',
  countryId: 'c1',
  text: '',
  createdAt: '2026-11-18T12:00:00.000Z',
  battleLabel: 'Battle for Kyiv (Ukraine vs Russia)',
  ...overrides,
});

const snap = (...orders: TrackedOrder[]) => new Map(orders.map(o => [o.id, o]));

const cfg = (overrides: Partial<BattleOrdersConfig> = {}): BattleOrdersConfig => ({
  enabled: true,
  channelId: 'chan',
  roleIds: [],
  priorities: ['low', 'medium', 'high'],
  countries: [{ countryId: 'c1', countryName: 'Ukraine' }],
  mus: [{ muId: 'mu1', muName: 'Impi' }],
  ...overrides,
});

describe('diffOrders', () => {
  const since = new Date('2026-11-18T11:55:00.000Z');

  it('reports orders created after the previous fetch as new', () => {
    expect(diffOrders(snap(), snap(order()), since)).toEqual([{ kind: 'new', order: order() }]);
  });

  it('ignores orders that already existed before they were tracked', () => {
    const old = order({ createdAt: '2026-11-18T09:00:00.000Z' });
    expect(diffOrders(snap(), snap(old), since)).toEqual([]);
  });

  it('reports priority changes and ended orders', () => {
    const raised = order({ priority: 'high' });
    const gone = order({ id: 'o2', priority: 'low' });
    const events = diffOrders(snap(order({ priority: 'medium' }), gone), snap(raised), since);
    expect(events).toEqual([
      { kind: 'changed', order: raised, previousPriority: 'medium' },
      { kind: 'ended', order: gone },
    ]);
  });

  it('is quiet when nothing changed', () => {
    expect(diffOrders(snap(order()), snap(order({ text: 'go' })), since)).toEqual([]);
  });
});

describe('eventsForServer', () => {
  it('keeps only tracked orderers at wanted levels', () => {
    const events = [
      { kind: 'new' as const, order: order({ priority: 'high' }) },
      { kind: 'new' as const, order: order({ id: 'o2', priority: 'low' }) },
      { kind: 'new' as const, order: order({ id: 'o3', countryId: 'other' }) },
      { kind: 'new' as const, order: order({ id: 'o4', countryId: undefined, muId: 'mu1' }) },
    ];
    const kept = eventsForServer(events, cfg({ priorities: ['high'] })).map(e => e.order.id);
    expect(kept).toEqual(['o1', 'o4']);
  });

  it('shows a change when either the old or new level is wanted', () => {
    const lowered = { kind: 'changed' as const, order: order({ priority: 'low' }), previousPriority: 'high' as const };
    const lowToMedium = { kind: 'changed' as const, order: order({ priority: 'medium' }), previousPriority: 'low' as const };
    expect(eventsForServer([lowered, lowToMedium], cfg({ priorities: ['high'] }))).toEqual([lowered]);
  });
});

describe('formatOrderEvent', () => {
  it('formats a new country order with its text and battle link', () => {
    const line = formatOrderEvent({ kind: 'new', order: order({ text: 'All in' }) }, cfg());
    expect(line).toBe(
      '🔴 **High** — **Ukraine** orders **attack** · Battle for Kyiv (Ukraine vs Russia) · <https://app.warera.io/battle/b1>\n> All in'
    );
  });

  it('names the MU for MU orders and describes changes and endings', () => {
    const mu = order({ countryId: undefined, muId: 'mu1', side: 'defender', priority: 'medium' });
    expect(formatOrderEvent({ kind: 'changed', order: mu, previousPriority: 'low' }, cfg())).toContain(
      '**Impi** changed its **defend** order Low → **Medium**'
    );
    expect(formatOrderEvent({ kind: 'ended', order: mu }, cfg())).toContain('⚪ **Impi** order to **defend** ended (was Medium)');
  });
});
