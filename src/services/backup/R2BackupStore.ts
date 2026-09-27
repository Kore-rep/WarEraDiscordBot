import {
  CopyObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command,
  PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { BackupConfig } from './backupConfig';

export interface BackupStore {
  upload(key: string, file: string, signal: AbortSignal): Promise<void>;
  copyDaily(source: string, destination: string, signal: AbortSignal): Promise<void>;
  close(): void;
}

export class R2BackupStore implements BackupStore {
  private readonly client: S3Client;

  constructor(private readonly config: BackupConfig) {
    this.client = new S3Client({
      region: 'auto', endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      // Retry streams ourselves, reopening the file for each attempt.
      maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async upload(key: string, file: string, signal: AbortSignal): Promise<void> {
    const { size } = await stat(file);
    if (size > 5_000_000_000) throw new Error('Backup exceeds the 5 GB single-upload limit');
    await this.retry(async (attemptSignal) => {
      const body = createReadStream(file);
      try {
        await this.client.send(new PutObjectCommand({
          Bucket: this.config.bucket, Key: key, Body: body, ContentLength: size,
          ContentType: 'application/octet-stream', Metadata: { format: 'warera-backup-v1' },
        }), { abortSignal: attemptSignal });
      } finally {
        body.destroy();
      }
    }, signal);
  }

  async copyDaily(source: string, destination: string, signal: AbortSignal): Promise<void> {
    await this.retry(async (attemptSignal) => {
      try {
        await this.client.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: destination }), { abortSignal: attemptSignal });
        return;
      } catch (error) {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404) throw error;
      }
      await this.client.send(new CopyObjectCommand({
        Bucket: this.config.bucket, Key: destination,
        CopySource: `${this.config.bucket}/${source.split('/').map(encodeURIComponent).join('/')}`,
      }), { abortSignal: attemptSignal });
    }, signal);
  }

  async list(): Promise<Array<{ key: string; bytes: number; modified?: string }>> {
    const items: Array<{ key: string; bytes: number; modified?: string }> = [];
    let token: string | undefined;
    do {
      const result = await this.client.send(new ListObjectsV2Command({
        Bucket: this.config.bucket, Prefix: `${this.config.prefix}/`, ContinuationToken: token,
      }), { abortSignal: AbortSignal.timeout(120_000) });
      for (const item of result.Contents ?? []) {
        if (item.Key) items.push({ key: item.Key, bytes: item.Size ?? 0, modified: item.LastModified?.toISOString() });
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
    return items.sort((a, b) => b.key.localeCompare(a.key));
  }

  async download(key: string, destination: string): Promise<void> {
    if (!key.startsWith(`${this.config.prefix}/`)) throw new Error('Object key is outside R2_BACKUP_PREFIX');
    const signal = AbortSignal.timeout(120_000);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }), { abortSignal: signal });
    if (!(response.Body instanceof Readable)) throw new Error('R2 returned no readable backup body');
    await pipeline(response.Body, createWriteStream(destination, { flags: 'wx', mode: 0o600 }), { signal });
  }

  close(): void { this.client.destroy(); }

  private async retry(action: (signal: AbortSignal) => Promise<void>, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      try {
        await action(AbortSignal.any([signal, AbortSignal.timeout(120_000)]));
        return;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (signal.aborted || attempt === 2 || (status && status < 500 && status !== 429 && status !== 408)) throw error;
        await delay(1000 * 2 ** attempt, undefined, { signal });
      }
    }
  }
}
