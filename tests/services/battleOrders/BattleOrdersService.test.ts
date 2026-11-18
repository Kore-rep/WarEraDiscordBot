import { BattleOrdersService, sidesWithTrackedOrders } from '../../../src/services/battleOrders/BattleOrdersService';
import { ServerConfigManager } from '../../../src/utils/serverConfigManager';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const battle = (id: string, attackerOrders: string[], defenderMuOrders: string[] = []) => ({
  _id: id,
  attacker: { country: 'c1', region: 'r1', countryOrders: attackerOrders, muOrders: [] },
  defender: { country: 'c2', region: 'r2', countryOrders: [], muOrders: defenderMuOrders },
});

const apiOrder = (id: string, priority: string, createdAt: string) => ({
  _id: id,
  battle: 'b1',
  side: 'attacker',
  sideCountry: 'c1',
  country: 'c1',
  user: 'u',
  priority,
  rank: 0,
  text: '',
  isActive: true,
  createdAt,
  updatedAt: createdAt,
  __v: 0,
});

describe('sidesWithTrackedOrders', () => {
  it('selects only sides where a tracked country or MU has ordered', () => {
    const battles = [battle('b1', ['c1']), battle('b2', ['zz'], ['mu1']), battle('b3', ['zz'])] as never;
    expect(sidesWithTrackedOrders(battles, new Set(['c1']), new Set(['mu1']))).toEqual([
      { battleId: 'b1', side: 'attacker' },
      { battleId: 'b2', side: 'defender' },
    ]);
  });
});

describe('BattleOrdersService cycle', () => {
  const sendToChannel = jest.fn().mockResolvedValue('msg');
  let orders: unknown[] | null;
  const apiService = {
    fetchAllBattles: jest.fn(async () => ({
      battles: [battle('b1', ['c1'])],
      countries: new Map([['c1', { name: 'Ukraine' }], ['c2', { name: 'Russia' }]]),
      regions: new Map([['r2', { name: 'Kyiv' }]]),
    })),
    fetchBattleOrders: jest.fn(async () => new Map([['b1:attacker', orders]])),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ServerConfigManager, 'readServerConfigs').mockReturnValue(
      new Map([
        [
          's1',
          {
            battleOrders: {
              enabled: true,
              channelId: 'chan',
              roleIds: ['role'],
              priorities: ['high'],
              countries: [{ countryId: 'c1', countryName: 'Ukraine' }],
              mus: [],
            },
          },
        ],
      ])
    );
  });

  it('primes silently, then posts new high orders and endings but not low ones', async () => {
    const service = new BattleOrdersService(5, apiService as never, { sendToChannel } as never);
    orders = [apiOrder('old', 'high', '2020-01-01T00:00:00.000Z')];
    await service.runCycle();
    expect(sendToChannel).not.toHaveBeenCalled();

    const now = new Date().toISOString();
    orders = [apiOrder('old', 'high', '2020-01-01T00:00:00.000Z'), apiOrder('fresh', 'high', now), apiOrder('quiet', 'low', now)];
    await service.runCycle();
    expect(sendToChannel).toHaveBeenCalledTimes(1);
    const [channel, body, opts] = sendToChannel.mock.calls[0];
    expect(channel).toBe('chan');
    expect(opts).toEqual({ roleIds: ['role'] });
    expect(body).toContain('**Ukraine** orders **attack** · Battle for Kyiv (Ukraine vs Russia)');
    expect(body).not.toContain('Low');

    orders = [apiOrder('fresh', 'high', now)];
    await service.runCycle();
    expect(sendToChannel.mock.calls[1][1]).toContain('order to **attack** ended (was High)');
  });

  it('keeps orders for a side whose fetch failed instead of reporting them ended', async () => {
    const service = new BattleOrdersService(5, apiService as never, { sendToChannel } as never);
    orders = [apiOrder('o1', 'high', '2020-01-01T00:00:00.000Z')];
    await service.runCycle();
    orders = null;
    await service.runCycle();
    orders = [apiOrder('o1', 'high', '2020-01-01T00:00:00.000Z')];
    await service.runCycle();
    expect(sendToChannel).not.toHaveBeenCalled();
  });
});
