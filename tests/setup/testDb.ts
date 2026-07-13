import { execSync } from 'child_process';
import * as path from 'path';
import { prisma } from '../../src/persistence/prisma';

const projectRoot = path.join(__dirname, '..', '..');

/** Apply the schema to this worker's test database. Call once in beforeAll. */
export function pushTestSchema(): void {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: process.env,
    stdio: 'ignore',
    cwd: projectRoot,
  });
}

/** Remove all rows so each test starts from a clean database. */
export async function clearTables(): Promise<void> {
  await prisma.weeklyDamageSnapshot.deleteMany();
  await prisma.linkedUser.deleteMany();
  await prisma.pendingLink.deleteMany();
  await prisma.pendingVerification.deleteMany();
  await prisma.server.deleteMany();
}
