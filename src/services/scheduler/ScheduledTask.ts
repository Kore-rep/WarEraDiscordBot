/**
 * A unit of periodic work driven by the SchedulerService.
 *
 * Services that need to run on an interval implement this instead of managing
 * their own timers, so that all scheduling lives in one place.
 */
export interface ScheduledTask {
  /** Human-readable identifier used in logs. */
  readonly name: string;

  /** How often runCycle() should run, in milliseconds. */
  readonly intervalMs: number;

  /**
   * Whether to run once immediately when the scheduler starts (default true).
   * Ignored when initialDelayMs is provided.
   */
  readonly runOnStart?: boolean;

  /**
   * Optional delay (ms) before the first run, e.g. to align to a clock boundary.
   * When provided, the scheduler waits this long before the first run and then
   * repeats every intervalMs; runOnStart is ignored.
   */
  initialDelayMs?(now: Date): number;

  /** Perform one cycle of work. Errors are caught and logged by the scheduler. */
  runCycle(): Promise<void>;
}
