import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logger } from '../../utils/logger';
import { ScheduledTask } from '../scheduler/ScheduledTask';
import { BackupConfig } from './backupConfig';
import { encryptBackup } from './backupArchive';
import { BackupStore } from './R2BackupStore';

/** Operator-only disaster recovery for the whole instance, never a Discord feature. */
export class BackupService implements ScheduledTask {
  readonly name = 'database-backup';
  readonly runOnStart = true;
  readonly intervalMs: number;
  private active?: Promise<void>;
  private readonly controller = new AbortController();
  private dailyCompleted?: string;

  constructor(
    private readonly config: BackupConfig,
    private readonly store: BackupStore,
    private readonly snapshot: (destination: string) => Promise<void>,
    private readonly now: () => Date = () => new Date()
  ) {
    this.intervalMs = config.intervalMs;
  }

  runCycle(): Promise<void> {
    if (this.controller.signal.aborted) return Promise.resolve();
    // Scheduler cycles can overlap. Reuse the running operation instead of starting another.
    if (!this.active) this.active = this.backup().finally(() => { this.active = undefined; });
    return this.active;
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await this.active?.catch(() => undefined);
    this.store.close();
  }

  private async backup(): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), 'warera-backup-'));
    let stage = 'snapshot';
    try {
      const database = join(directory, 'bot.db');
      const archive = join(directory, 'bot.db.gz.enc');
      const signal = this.controller.signal;
      await this.snapshot(database);
      signal.throwIfAborted();
      stage = 'encryption';
      await encryptBackup(database, archive, this.config.encryptionKey);
      // Keep only ciphertext during the potentially slow network operation.
      await rm(database);
      const timestamp = this.now().toISOString();
      const key = `${this.config.prefix}/hourly/${timestamp.replace(/:/g, '-')}-${randomUUID()}.db.gz.enc`;
      stage = 'hourly upload';
      await this.store.upload(key, archive, signal);
      const day = timestamp.slice(0, 10);
      if (day !== this.dailyCompleted) {
        stage = 'daily copy';
        await this.store.copyDaily(key, `${this.config.prefix}/daily/${day}.db.gz.enc`, signal);
        this.dailyCompleted = day;
      }
      logger.info(`Database backup uploaded: ${key}`);
    } catch (error) {
      // Avoid logging SDK request objects or credentials through the generic scheduler logger.
      const code = error instanceof Error ? error.name : 'UnknownError';
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      throw new Error(`Database backup failed during ${stage} (${code}${status ? `, HTTP ${status}` : ''}); no confirmed full cycle.`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
