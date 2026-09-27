import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBackupConfig, loadBackupEncryptionKey } from '../services/backup/backupConfig';
import { restoreBackup } from '../services/backup/backupArchive';
import { R2BackupStore } from '../services/backup/R2BackupStore';
import { BackupService } from '../services/backup/BackupService';
import { snapshotDatabase } from '../persistence/databaseBackup';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'keygen' && args.length === 0) {
    console.log(randomBytes(32).toString('base64'));
    return;
  }
  if (command === 'decrypt' && args.length === 2) {
    await restoreBackup(args[0], args[1], loadBackupEncryptionKey());
    console.log(`Verified database restored to ${args[1]}. The running database was not replaced.`);
    return;
  }
  if (!((command === 'once' || command === 'list') && args.length === 0) && !(command === 'restore' && args.length === 2)) {
    console.log('Usage: npm run backup -- once | list | restore <object-key> <new-db-path> | decrypt <local-archive> <new-db-path> | keygen');
    if (command && command !== '--help') process.exitCode = 1;
    return;
  }
  // Manual operator commands also work when scheduled backups are disabled.
  const config = loadBackupConfig({ ...process.env, BACKUP_ENABLED: 'true' })!;
  const store = new R2BackupStore(config);
  try {
    if (command === 'once') {
      const { prisma } = await import('../persistence/prisma');
      // Do not load ServerConfigManager here: a separate process must not rewrite
      // the live bot's in-memory configuration. Snapshot committed database state.
      const service = new BackupService(config, store, (destination) => snapshotDatabase(prisma, destination));
      const stop = () => { void service.stop(); };
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      try {
        await service.runCycle();
      } finally {
        process.removeListener('SIGTERM', stop);
        process.removeListener('SIGINT', stop);
        await service.stop();
        await prisma.$disconnect();
      }
    } else if (command === 'list') {
      console.log(JSON.stringify(await store.list(), null, 2));
    } else {
      const directory = await mkdtemp(join(tmpdir(), 'warera-download-'));
      try {
        const archive = join(directory, 'backup.enc');
        await store.download(args[0], archive);
        await restoreBackup(archive, args[1], config.encryptionKey);
        console.log(`Verified database restored to ${args[1]}. The running database was not replaced.`);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  } finally {
    store.close();
  }
}

void main().catch((error: unknown) => {
  // SDK errors may include request details; never dump those into operator logs.
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  if (status) console.error(`Backup command failed: R2 HTTP ${status}. Check credentials, bucket, and object key.`);
  else console.error(error instanceof Error ? error.message : 'Backup command failed');
  process.exitCode = 1;
});
