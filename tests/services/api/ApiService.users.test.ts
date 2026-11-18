import { ApiService } from '../../../src/services/api/ApiService';
import { BotConfig } from '../../../src/config/config';

const mockCreateAPI = jest.fn();
jest.mock('warera-sdk', () => ({
  createAPI: (config: any) => mockCreateAPI(config),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const config = {
  api: { baseUrl: 'https://api.test.com', apiKey: 'k' },
  discord: { token: 't', servers: new Map() },
  polling: { intervalMinutes: 1 },
} as unknown as BotConfig;

const ok = (data: unknown) => Promise.resolve({ result: { data } });

/** A fake batch client; each createAPI() call returns a fresh one so batches can be counted. */
function fakeClient(missingSkills: Set<string> = new Set()) {
  return {
    user: {
      getUserLite: jest.fn((id: string) => (id === 'gone' ? Promise.reject(new Error('404')) : ok({ _id: id, username: `u-${id}` }))),
      getUserSkills: jest.fn((id: string) =>
        missingSkills.has(id) ? Promise.reject(new Error('404')) : ok({ _id: id, skills: { attack: { level: 3 } }, skillsExpiration: {} })
      ),
    },
    runBatch: jest.fn(() => Promise.resolve()),
  };
}

describe('ApiService user fetching', () => {
  let clients: ReturnType<typeof fakeClient>[];
  let missingSkills: Set<string>;
  let api: ApiService;

  beforeEach(() => {
    clients = [];
    missingSkills = new Set();
    mockCreateAPI.mockImplementation(() => {
      const c = fakeClient(missingSkills);
      clients.push(c);
      return c;
    });
    api = new ApiService(config);
    clients.length = 0; // ignore the constructor's singleton clients
  });

  it('merges skills into lite profiles and omits users missing either half', async () => {
    missingSkills.add('b');
    const users = await api.fetchUsersWithSkills(['a', 'b', 'gone']);
    expect([...users.keys()]).toEqual(['a']);
    expect(users.get('a')).toMatchObject({ username: 'u-a', skills: { attack: { level: 3 } }, skillsExpiration: {} });
  });

  it('queues lite + skills in the same batch, 50 users (100 sub-requests) per batch', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`);
    const users = await api.fetchUsersWithSkills(ids);
    expect(users.size).toBe(120);
    expect(clients.map(c => c.user.getUserLite.mock.calls.length)).toEqual([50, 50, 20]);
    expect(clients.map(c => c.user.getUserSkills.mock.calls.length)).toEqual([50, 50, 20]);
    expect(clients.every(c => c.runBatch.mock.calls.length === 1)).toBe(true);
  });

  it('fetches lite profiles only, 100 per batch, without skills calls', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `id${i}`);
    const users = await api.fetchUsersLite(ids, { cacheTtlMs: 5000 });
    expect(users.size).toBe(150);
    expect(clients.map(c => c.user.getUserLite.mock.calls.length)).toEqual([100, 50]);
    expect(clients[0].user.getUserLite).toHaveBeenCalledWith('id0', { cache: { ttl: 5000 } });
    expect(clients.every(c => c.user.getUserSkills.mock.calls.length === 0)).toBe(true);
  });
});
