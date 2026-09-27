import { CopyObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { R2BackupStore } from '../../../src/services/backup/R2BackupStore';

describe('R2 backup transport', () => {
  const store = () => new R2BackupStore({
    endpoint: 'https://account.r2.cloudflarestorage.com', bucket: 'backups',
    accessKeyId: 'test-id', secretAccessKey: 'test-secret', encryptionKey: Buffer.alloc(32),
    prefix: 'warera-bot', intervalMs: 60_000,
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('reopens the complete stream after a transient upload failure', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'r2-upload-test-'));
    const file = join(directory, 'archive');
    await writeFile(file, 'encrypted backup contents');
    const bodies: string[] = [];
    const send = jest.spyOn(S3Client.prototype, 'send').mockImplementation((async (command: PutObjectCommand) => {
      const chunks: Buffer[] = [];
      for await (const chunk of command.input.Body as Readable) chunks.push(Buffer.from(chunk));
      bodies.push(Buffer.concat(chunks).toString());
      if (bodies.length === 1) throw Object.assign(new Error('temporary'), { $metadata: { httpStatusCode: 503 } });
      return {};
    }) as typeof S3Client.prototype.send);
    const client = store();
    try {
      await client.upload('warera-bot/hourly/test.enc', file, new AbortController().signal);
      expect(send).toHaveBeenCalledTimes(2);
      expect(bodies).toEqual(['encrypted backup contents', 'encrypted backup contents']);
    } finally {
      client.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('preserves an existing daily backup and only creates a missing one', async () => {
    const send = jest.spyOn(S3Client.prototype, 'send').mockResolvedValue({} as never);
    const client = store();
    try {
      const signal = new AbortController().signal;
      await client.copyDaily('warera-bot/hourly/source.enc', 'warera-bot/daily/day.enc', signal);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
      send.mockClear();
      send.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } } as never);
      await client.copyDaily('warera-bot/hourly/source.enc', 'warera-bot/daily/day.enc', signal);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1][0]).toBeInstanceOf(CopyObjectCommand);
      expect((send.mock.calls[1][0] as CopyObjectCommand).input).toMatchObject({
        CopySource: 'backups/warera-bot/hourly/source.enc', Key: 'warera-bot/daily/day.enc',
      });
    } finally { client.close(); }
  });

  it('fails immediately on forbidden access instead of treating it as a missing backup', async () => {
    const failure = { $metadata: { httpStatusCode: 403 } };
    const send = jest.spyOn(S3Client.prototype, 'send').mockRejectedValue(failure as never);
    const client = store();
    try {
      await expect(client.copyDaily('warera-bot/hourly/source.enc', 'warera-bot/daily/day.enc', new AbortController().signal)).rejects.toEqual(failure);
      expect(send).toHaveBeenCalledTimes(1);
    } finally { client.close(); }
  });
});
