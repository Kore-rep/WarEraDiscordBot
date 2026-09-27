import { readFileSync } from 'node:fs';

export interface BackupConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  encryptionKey: Buffer;
  prefix: string;
  intervalMs: number;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  if (env[name] && env[`${name}_FILE`]) {
    throw new Error(`Set only ${name} or ${name}_FILE, not both`);
  }
  if (env[`${name}_FILE`]) {
    try {
      return readFileSync(env[`${name}_FILE`]!, 'utf8').trim();
    } catch {
      throw new Error(`Cannot read ${name}_FILE`);
    }
  }
  return env[name]?.trim() ?? '';
}

export function loadBackupEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const value = secret(env, 'BACKUP_ENCRYPTION_KEY');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new Error('BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key (use npm run backup:keygen)');
  }
  return key;
}

/** Operator configuration: a whole-instance backup contains every guild's data. */
export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig | undefined {
  const enabled = env.BACKUP_ENABLED?.trim().toLowerCase();
  if (!enabled || enabled === 'false') return undefined;
  if (enabled !== 'true') throw new Error('BACKUP_ENABLED must be true or false');

  const endpoint = env.R2_ENDPOINT?.trim() ?? '';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('R2_ENDPOINT must be the HTTPS S3 endpoint from the R2 dashboard');
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.r2.cloudflarestorage.com') ||
      url.username || url.password || url.search || url.hash || url.port || url.pathname !== '/') {
    throw new Error('R2_ENDPOINT must be the HTTPS S3 endpoint from the R2 dashboard');
  }
  const bucket = env.R2_BUCKET?.trim() ?? '';
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('R2_BUCKET must be a valid R2 bucket name');
  }
  const accessKeyId = secret(env, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = secret(env, 'R2_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) throw new Error('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required');

  const prefix = env.R2_BACKUP_PREFIX?.trim() || 'warera-bot';
  if (!/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) {
    throw new Error('R2_BACKUP_PREFIX must contain letters, digits, underscores, hyphens, and optional path segments');
  }
  const minutes = Number(env.BACKUP_INTERVAL_MINUTES ?? '60');
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    throw new Error('BACKUP_INTERVAL_MINUTES must be an integer between 1 and 1440');
  }
  return {
    endpoint: url.origin, bucket, accessKeyId, secretAccessKey,
    encryptionKey: loadBackupEncryptionKey(env), prefix, intervalMs: minutes * 60_000,
  };
}
