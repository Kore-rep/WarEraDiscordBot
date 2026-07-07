import { logger } from '../../utils/logger';
import { ScheduledTask } from './ScheduledTask';

/**
 * Owns every periodic task in the bot. Each registered ScheduledTask runs on its
 * own interval; a failure in one cycle is caught and logged so it never affects
 * the others or stops the timer.
 */
export class SchedulerService {
  private readonly tasks: ScheduledTask[];
  private readonly timers: NodeJS.Timeout[] = [];
  private isRunning = false;

  constructor(tasks: ScheduledTask[]) {
    this.tasks = tasks;
  }

  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler is already running');
      return;
    }

    logger.info(`Starting scheduler with ${this.tasks.length} task(s): ${this.tasks.map(t => t.name).join(', ')}`);
    for (const task of this.tasks) {
      this.scheduleTask(task);
    }
    this.isRunning = true;
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }
    for (const timer of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.length = 0;
    this.isRunning = false;
    logger.info('Scheduler stopped');
  }

  isActive(): boolean {
    return this.isRunning;
  }

  private scheduleTask(task: ScheduledTask): void {
    const startInterval = () => {
      const interval = setInterval(() => void this.runTask(task), task.intervalMs);
      this.timers.push(interval);
    };

    if (task.initialDelayMs) {
      const delay = task.initialDelayMs(new Date());
      logger.info(`Task "${task.name}" first run in ${Math.round(delay / 1000)}s, then every ${task.intervalMs / 1000}s`);
      const timeout = setTimeout(() => {
        void this.runTask(task);
        startInterval();
      }, delay);
      this.timers.push(timeout);
      return;
    }

    if (task.runOnStart !== false) {
      void this.runTask(task);
    }
    startInterval();
  }

  private async runTask(task: ScheduledTask): Promise<void> {
    try {
      await task.runCycle();
    } catch (error) {
      logger.error(`Scheduled task "${task.name}" failed`, error);
    }
  }
}
