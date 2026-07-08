import { SchedulerService } from '../../../src/services/scheduler/SchedulerService';
import { ScheduledTask } from '../../../src/services/scheduler/ScheduledTask';

jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

describe('SchedulerService', () => {
  beforeEach(() => jest.useFakeTimers({ doNotFake: ['setImmediate'] }));
  afterEach(() => jest.useRealTimers());

  const makeTask = (over: Partial<ScheduledTask> = {}): ScheduledTask => ({
    name: 'task',
    intervalMs: 1000,
    runCycle: jest.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('runs each task once immediately on start by default', async () => {
    const a = makeTask({ name: 'a' });
    const b = makeTask({ name: 'b' });
    new SchedulerService([a, b]).start();
    await flushPromises();

    expect(a.runCycle).toHaveBeenCalledTimes(1);
    expect(b.runCycle).toHaveBeenCalledTimes(1);
  });

  it('does not run immediately when runOnStart is false, but runs on interval', async () => {
    const task = makeTask({ runOnStart: false, intervalMs: 1000 });
    new SchedulerService([task]).start();
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(1000);
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(1);
  });

  it('repeats a task on its interval', async () => {
    const task = makeTask({ intervalMs: 1000 });
    new SchedulerService([task]).start();
    await flushPromises();

    jest.advanceTimersByTime(3000);
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(4); // once on start + 3 intervals
  });

  it('isolates failures so other tasks keep running', async () => {
    const failing = makeTask({ name: 'failing', runCycle: jest.fn().mockRejectedValue(new Error('boom')) });
    const healthy = makeTask({ name: 'healthy' });
    new SchedulerService([failing, healthy]).start();
    await flushPromises();

    expect(healthy.runCycle).toHaveBeenCalledTimes(1);

    // Failing task continues to be scheduled on subsequent intervals
    jest.advanceTimersByTime(1000);
    await flushPromises();
    expect(failing.runCycle).toHaveBeenCalledTimes(2);
    expect(healthy.runCycle).toHaveBeenCalledTimes(2);
  });

  it('honors initialDelayMs for the first run instead of running immediately', async () => {
    const task = makeTask({ intervalMs: 1000, initialDelayMs: () => 500 });
    new SchedulerService([task]).start();
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(0);

    jest.advanceTimersByTime(500);
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(2);
  });

  it('stops all tasks', async () => {
    const task = makeTask({ intervalMs: 1000 });
    const scheduler = new SchedulerService([task]);
    scheduler.start();
    await flushPromises();
    scheduler.stop();

    jest.advanceTimersByTime(5000);
    await flushPromises();
    expect(task.runCycle).toHaveBeenCalledTimes(1); // only the initial run
    expect(scheduler.isActive()).toBe(false);
  });
});
