import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotDatabase } from '../../../src/persistence/databaseBackup';
import { encryptBackup, restoreBackup } from '../../../src/services/backup/backupArchive';
import { BackupService } from '../../../src/services/backup/BackupService';
import { BackupConfig, loadBackupConfig, loadBackupEncryptionKey } from '../../../src/services/backup/backupConfig';
import { BackupStore } from '../../../src/services/backup/R2BackupStore';

describe('database backups', () => {
  let directory: string;
  let source: PrismaClient;
  const key = randomBytes(32);
  const config: BackupConfig = {
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'backups',
    accessKeyId: 'test-id', secretAccessKey: 'test-secret', encryptionKey: key,
    prefix: 'warera-bot', intervalMs: 60_000,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'warera-backup-test-'));
    source = new PrismaClient({ datasourceUrl: `file:${join(directory, 'source.db')}` });
    await source.$queryRawUnsafe('PRAGMA journal_mode=WAL');
    await source.$executeRawUnsafe('CREATE TABLE Server (id TEXT PRIMARY KEY, value TEXT)');
    await source.$executeRawUnsafe("INSERT INTO Server VALUES ('guild-a', 'alpha'), ('guild-b', 'beta')");
  });
  afterEach(async () => {
    await source.$disconnect();
    await rm(directory, { recursive: true, force: true });
  });

  it('round-trips a consistent snapshot with committed WAL data for all guilds', async () => {
    const snapshot = join(directory, "snapshot's.db");
    const archive = join(directory, 'backup.enc');
    const output = join(directory, 'restored.db');
    await snapshotDatabase(source, snapshot);
    await source.$executeRawUnsafe("UPDATE Server SET value = 'changed' WHERE id = 'guild-a'");
    await encryptBackup(snapshot, archive, key);
    expect((await readFile(archive)).includes(Buffer.from('alpha'))).toBe(false);
    await restoreBackup(archive, output, key);
    const restored = new PrismaClient({ datasourceUrl: `file:${output}` });
    try {
      expect(await restored.$queryRawUnsafe('SELECT * FROM Server ORDER BY id')).toEqual([
        { id: 'guild-a', value: 'alpha' }, { id: 'guild-b', value: 'beta' },
      ]);
    } finally { await restored.$disconnect(); }
  });

  it('refuses wrong keys, tampered ciphertext, truncated files, and existing destinations', async () => {
    const snapshot = join(directory, 'snapshot.db');
    const archive = join(directory, 'backup.enc');
    const output = join(directory, 'restored.db');
    await snapshotDatabase(source, snapshot);
    await encryptBackup(snapshot, archive, key);
    await expect(restoreBackup(archive, output, randomBytes(32))).rejects.toThrow();
    const valid = await readFile(archive);
    const corrupt = Buffer.from(valid);
    corrupt[25] ^= 1;
    await writeFile(archive, corrupt);
    await expect(restoreBackup(archive, output, key)).rejects.toThrow();
    await writeFile(archive, valid.subarray(0, 25));
    await expect(restoreBackup(archive, output, key)).rejects.toThrow('truncated');
    expect(await readdir(directory)).not.toContain('restored.db');
    expect((await readdir(directory)).filter(name => name.startsWith('.warera-restore-'))).toEqual([]);
    await writeFile(archive, valid);
    await writeFile(output, 'existing database');
    await expect(restoreBackup(archive, output, key)).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('existing database');
  });

  it('coalesces overlapping cycles and makes one daily copy per UTC day', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let snapshotDirectory = '';
    const snapshot = jest.fn(async (destination: string) => {
      snapshotDirectory = destination;
      await gate;
      await snapshotDatabase(source, destination);
    });
    const upload = jest.fn(async (_key: string, file: string) => {
      expect((await readFile(file)).subarray(0, 8).toString()).toBe('WERABK01');
    });
    const store: BackupStore = { upload, copyDaily: jest.fn(async () => {}), close: jest.fn() };
    let now = new Date('2026-09-21T12:00:00Z');
    const service = new BackupService(config, store, snapshot, () => now);
    const first = service.runCycle();
    expect(service.runCycle()).toBe(first);
    release();
    await first;
    await expect(readFile(snapshotDirectory)).rejects.toThrow();
    await service.runCycle();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(store.copyDaily).toHaveBeenCalledTimes(1);
    expect(store.copyDaily).toHaveBeenCalledWith(expect.stringContaining('/hourly/'), 'warera-bot/daily/2026-09-21.db.gz.enc', expect.any(AbortSignal));
    now = new Date('2026-09-22T00:02:00Z');
    await service.runCycle();
    expect(store.copyDaily).toHaveBeenCalledTimes(2);
    await service.stop();
    await service.runCycle();
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('cleans failed backups, omits daily copy, and permits the next scheduled attempt', async () => {
    let filePath = '';
    const upload = jest.fn(async (_key: string, file: string) => {
      filePath = file;
      throw new Error('sensitive request data');
    });
    const store: BackupStore = { upload, copyDaily: jest.fn(async () => {}), close: jest.fn() };
    const service = new BackupService(config, store, destination => snapshotDatabase(source, destination));
    await expect(service.runCycle()).rejects.toThrow('during hourly upload (Error)');
    await expect(readFile(filePath)).rejects.toThrow();
    expect(store.copyDaily).not.toHaveBeenCalled();
    await expect(service.runCycle()).rejects.not.toThrow('sensitive request data');
    expect(upload).toHaveBeenCalledTimes(2);
    await service.stop();
  });

  it('supports disabled backups, validates configuration, and reads mounted secrets', async () => {
    expect(loadBackupConfig({})).toBeUndefined();
    expect(() => loadBackupConfig({ BACKUP_ENABLED: 'yes' })).toThrow();
    const env = {
      BACKUP_ENABLED: 'true', R2_ENDPOINT: config.endpoint, R2_BUCKET: config.bucket,
      R2_ACCESS_KEY_ID: 'id', R2_SECRET_ACCESS_KEY: 'secret', BACKUP_ENCRYPTION_KEY: key.toString('base64'),
    };
    expect(loadBackupConfig(env)?.intervalMs).toBe(3_600_000);
    expect(() => loadBackupConfig({ ...env, BACKUP_INTERVAL_MINUTES: '1.5' })).toThrow();
    expect(() => loadBackupConfig({ ...env, R2_ENDPOINT: 'http://example.com' })).toThrow();
    expect(() => loadBackupConfig({ ...env, R2_BACKUP_PREFIX: '../other' })).toThrow();
    expect(() => loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY: 'short' })).toThrow();
    const keyFile = join(directory, 'key');
    await writeFile(keyFile, `${key.toString('base64')}\n`, { mode: 0o600 });
    expect(loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY_FILE: keyFile })).toEqual(key);
    expect(() => loadBackupEncryptionKey({ BACKUP_ENCRYPTION_KEY_FILE: keyFile, BACKUP_ENCRYPTION_KEY: 'both' })).toThrow('not both');
  });
});
