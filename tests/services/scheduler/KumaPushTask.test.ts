import { KumaPushTask } from '../../../src/services/scheduler/tasks/KumaPushTask';
import { SchedulerService } from '../../../src/services/scheduler/SchedulerService';
import { logger } from '../../../src/utils/logger';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const pushUrl = 'http://kuma.test:3001/api/push/test-secret?status=up&msg=OK&ping=';
const flushPromises = () => new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch;

describe('KumaPushTask', () => {
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response('{"ok":true}'));
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('pushes immediately, every 30 seconds, and stops with the scheduler', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    // Return a fresh body for every heartbeat.
    fetchMock.mockImplementation(async () => new Response('{"ok":true}'));
    const scheduler = new SchedulerService([new KumaPushTask(pushUrl, () => true)]);
    try {
      scheduler.start();
      await flushPromises();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(29_999);
      await flushPromises();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(1);
      await flushPromises();
      expect(fetchMock).toHaveBeenCalledTimes(2);

      scheduler.stop();
      jest.advanceTimersByTime(60_000);
      await flushPromises();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      scheduler.stop();
    }
  });

  it('sends an up heartbeat and retains the ping query with a 10-second timeout', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await new KumaPushTask(pushUrl, () => true).runCycle();

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(pushUrl);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(options?.signal).toBe(timeout.mock.results[0].value);
  });

  it('skips disconnected cycles and resumes when Discord is ready', async () => {
    const isReady = jest.fn().mockReturnValue(false);
    const task = new KumaPushTask(pushUrl, isReady);
    await task.runCycle();
    expect(fetchMock).not.toHaveBeenCalled();

    isReady.mockReturnValue(true);
    await task.runCycle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Response('{"ok":false}', { status: 404 }),
    new Response('{"ok":false}'),
    new Response('not JSON'),
  ])('rejects unsuccessful HTTP or Kuma responses', async (response) => {
    fetchMock.mockResolvedValue(response);
    await expect(new KumaPushTask(pushUrl, () => true).runCycle()).rejects.toThrow('Kuma heartbeat failed');
  });

  it('logs a safe failure and recovers on the next interval after a network error', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    fetchMock.mockRejectedValueOnce(new Error(`Request failed: ${pushUrl}`));
    const scheduler = new SchedulerService([new KumaPushTask(pushUrl, () => true)]);
    try {
      scheduler.start();
      await flushPromises();
      expect(logger.error).toHaveBeenCalledWith(
        'Scheduled task "kuma-push" failed',
        expect.objectContaining({ message: expect.stringContaining('Kuma heartbeat failed') }),
      );
      expect(String(jest.mocked(logger.error).mock.calls[0][1])).not.toContain('test-secret');

      jest.advanceTimersByTime(30_000);
      await flushPromises();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
    } finally {
      scheduler.stop();
    }
  });
});
