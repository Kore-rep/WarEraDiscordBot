import { ServerConfigManager } from '../../src/utils/serverConfigManager';
import { prisma } from '../../src/persistence/prisma';
import { pushTestSchema, clearTables } from '../setup/testDb';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const SERVER = 'mu-list-server';

describe('ServerConfigManager shared military-unit list', () => {
  beforeAll(() => {
    pushTestSchema();
  });

  afterAll(async () => {
    ServerConfigManager.clearCache();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await ServerConfigManager.flush();
    await clearTables();
    await prisma.server.create({ data: { id: SERVER } });
    await ServerConfigManager.loadConfigs();
  });

  afterEach(async () => {
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
  });

  it('defaults to an empty list', () => {
    expect(ServerConfigManager.getMilitaryUnits(SERVER)).toEqual([]);
  });

  it('stores units with and without a role mapping', () => {
    ServerConfigManager.updateMilitaryUnits(SERVER, [
      { muId: 'mu1', muName: 'Assegai', roleId: 'role-1' },
      { muId: 'mu2', muName: 'Impi' },
    ]);

    expect(ServerConfigManager.getMilitaryUnits(SERVER)).toEqual([
      { muId: 'mu1', muName: 'Assegai', roleId: 'role-1' },
      { muId: 'mu2', muName: 'Impi' },
    ]);
  });

  it('round-trips and normalizes through the database', async () => {
    ServerConfigManager.updateMilitaryUnits(SERVER, [
      { muId: ' mu1 ', muName: ' Assegai ', roleId: ' role-1 ' },
      { muId: 'mu2', muName: '' },
      { muId: '', muName: 'dropped' },
    ]);
    await ServerConfigManager.flush();
    ServerConfigManager.clearCache();
    await ServerConfigManager.loadConfigs();

    expect(ServerConfigManager.getMilitaryUnits(SERVER)).toEqual([
      { muId: 'mu1', muName: 'Assegai', roleId: 'role-1' },
      { muId: 'mu2', muName: 'MU mu2' },
    ]);
  });

  it('returns a deep copy that does not mutate the cache', () => {
    ServerConfigManager.updateMilitaryUnits(SERVER, [{ muId: 'mu1', muName: 'Assegai' }]);
    const units = ServerConfigManager.getMilitaryUnits(SERVER);
    units.push({ muId: 'injected', muName: 'leak' });
    units[0].muName = 'changed';

    expect(ServerConfigManager.getMilitaryUnits(SERVER)).toEqual([{ muId: 'mu1', muName: 'Assegai' }]);
  });
});
