import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, link, mkdtemp, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { verifyDatabase } from '../../persistence/databaseBackup';

// Format v1: magic (8) | random nonce (12) | gzip encrypted with AES-256-GCM | tag (16).
// Header is authenticated as AAD. A new nonce is generated for every archive.
const MAGIC = Buffer.from('WERABK01', 'ascii');
const HEADER_SIZE = MAGIC.length + 12;
const TAG_SIZE = 16;

export async function encryptBackup(source: string, destination: string, key: Buffer): Promise<void> {
  const nonce = randomBytes(12);
  const header = Buffer.concat([MAGIC, nonce]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(header);
  const file = await open(destination, 'wx', 0o600);
  try {
    await file.writeFile(header);
  } finally {
    await file.close();
  }
  await pipeline(createReadStream(source), createGzip(), cipher, createWriteStream(destination, { flags: 'a' }));
  await appendFile(destination, cipher.getAuthTag());
}

/** Restore only to a NEW file; authentication and SQLite validation precede publication. */
export async function restoreBackup(archive: string, destination: string, key: Buffer): Promise<void> {
  const output = resolve(destination);
  const temporary = await mkdtemp(join(dirname(output), '.warera-restore-'));
  const compressed = join(temporary, 'authenticated.gz');
  const database = join(temporary, 'bot.db');
  try {
    const file = await open(archive, 'r');
    let header: Buffer;
    let tag: Buffer;
    let size: number;
    try {
      size = (await file.stat()).size;
      if (size <= HEADER_SIZE + TAG_SIZE) throw new Error('Invalid or truncated backup archive');
      header = Buffer.alloc(HEADER_SIZE);
      tag = Buffer.alloc(TAG_SIZE);
      await file.read(header, 0, HEADER_SIZE, 0);
      await file.read(tag, 0, TAG_SIZE, size - TAG_SIZE);
      if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Unsupported backup archive format');
    } finally {
      await file.close();
    }
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length));
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    // Authenticate completely before decompressing or exposing plaintext SQLite.
    await pipeline(
      createReadStream(archive, { start: HEADER_SIZE, end: size - TAG_SIZE - 1 }),
      decipher,
      createWriteStream(compressed, { flags: 'wx', mode: 0o600 })
    );
    await pipeline(createReadStream(compressed), createGunzip(), createWriteStream(database, { flags: 'wx', mode: 0o600 }));
    await verifyDatabase(database);
    // Same-filesystem hard link is atomic and refuses to overwrite an existing file.
    await link(database, output);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
