import * as path from 'path';

// Point each Jest worker at its own SQLite file so parallel workers don't contend
// for a single database. Set before any module (and the Prisma client) is imported.
const worker = process.env.JEST_WORKER_ID ?? '1';
process.env.DATABASE_URL = `file:${path.join(__dirname, '..', '..', 'data', `test-${worker}.db`)}`;
