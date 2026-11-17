import { ScheduledTask } from '../ScheduledTask';

/** One process-wide heartbeat, sent only while the Discord client is ready. */
export class KumaPushTask implements ScheduledTask {
  readonly name = 'kuma-push';
  readonly intervalMs = 30_000;

  constructor(
    private readonly pushUrl: string,
    private readonly isReady: () => boolean,
  ) {}

  async runCycle(): Promise<void> {
    if (!this.isReady()) {
      return;
    }

    const url = new URL(this.pushUrl);
    url.searchParams.set('status', 'up');
    url.searchParams.set('msg', 'OK');

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('HTTP failure');
      }
      const result: unknown = await response.json();
      if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true) {
        throw new Error('Push rejected');
      }
    } catch {
      // Fetch errors and response messages can contain the secret push URL.
      // Let the scheduler log a safe error and retry on the next interval.
      throw new Error('Kuma heartbeat failed; check connectivity and that the push monitor is active');
    }
  }
}
