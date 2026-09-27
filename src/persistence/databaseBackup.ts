import { PrismaClient } from '@prisma/client';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Infrastructure-only, whole-database snapshot. Never expose this to guild commands. */
export async function snapshotDatabase(client: PrismaClient, destination: string): Promise<void> {
  // VACUUM INTO takes a consistent SQLite snapshot, including committed WAL data.
  // Binding the filename also handles spaces/quotes without SQL interpolation.
  await client.$executeRaw`VACUUM INTO ${resolve(destination)}`;
  await verifyDatabase(destination);
}

export async function verifyDatabase(file: string): Promise<void> {
  const info = await stat(file); // Do not let Prisma create a missing restore file.
  if (!info.isFile() || info.size === 0) throw new Error('Backup database is empty or missing');
  const client = new PrismaClient({ datasourceUrl: `file:${resolve(file)}` });
  try {
    const result = await client.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
    if (result.length !== 1 || result[0].integrity_check !== 'ok') {
      throw new Error('Backup database failed SQLite integrity_check');
    }
    const tables = await client.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Server'"
    );
    if (tables.length !== 1) throw new Error('Backup does not contain the bot Server table');
  } finally {
    await client.$disconnect();
  }
}
