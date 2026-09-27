# Cloudflare R2 database backups

The bot can back up its complete SQLite database to an existing private R2 bucket.
This is operator infrastructure: an archive contains data for **all Discord servers**,
and no guild command exposes backups or credentials. Secrets and in-memory state
outside SQLite are not included.

Backups are disabled by default. When enabled, the bot takes a backup on scheduler
startup and every 60 minutes. SQLite `VACUUM INTO` creates a consistent snapshot
including committed WAL data; queued configuration writes are flushed first. The
snapshot passes `PRAGMA integrity_check`, is compressed with gzip, and encrypted
locally with AES-256-GCM before upload. Restores authenticate and validate the
database before publishing a new file. A snapshot is a database read workload and
may delay writes while it runs; provision temporary disk space for the database
snapshot and compressed archive.

## 1. Configure your existing R2 bucket

1. Open the bucket in Cloudflare's R2 dashboard. Use Standard storage. Keep public
   access disabled (no public `r2.dev` URL or public custom domain).
2. Copy the **S3 API endpoint** from the bucket settings. Jurisdictional buckets
   may use an endpoint such as `https://ACCOUNT_ID.eu.r2.cloudflarestorage.com`.
3. Under R2 **Manage API tokens**, create a token with **Object Read & Write**
   scoped to this bucket only. Save its **Access Key ID** and **Secret Access Key**
   on the server. These are S3 credentials, not the Cloudflare management API token.
   The app does not need bucket administrator permissions. The credential scope
   is the bucket; the backup prefix is application isolation, not an IAM boundary.
4. Choose a unique prefix for this bot instance, default `warera-bot`. Use a
   different prefix for staging or another deployment. Run one backup writer per
   prefix; the overlap guard is within one process.
5. Add these two **object lifecycle rules** under bucket Settings, keeping any
   existing rules intact:

   | Prefix | Action |
   | --- | --- |
   | `warera-bot/hourly/` | Delete objects after 7 days |
   | `warera-bot/daily/` | Delete objects after 30 days |

   Replace `warera-bot` if you choose another prefix. Review existing broad rules
   that might expire these objects earlier. Do not apply these deletion rules to
   the entire shared bucket. The bot never changes bucket settings or deletes
   remote objects. Without lifecycle rules, retained storage grows indefinitely.

Official references: [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/),
[object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

## 2. Configure the server

Build and run with Node 24+ (the Dockerfile uses Node 24 Alpine). Set these values
in the existing deployment's environment; `.env.example` includes every option:

```dotenv
BACKUP_ENABLED=true
BACKUP_INTERVAL_MINUTES=60
R2_ENDPOINT=https://32d70f3dcb7bdab3e274c0f727dcb88e.r2.cloudflarestorage.com
R2_BUCKET=rsa-warera-discord-bot
R2_BACKUP_PREFIX=warera-bot
R2_ACCESS_KEY_ID=YOUR_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=YOUR_SECRET_ACCESS_KEY
BACKUP_ENCRYPTION_KEY=YOUR_BASE64_KEY
```

Generate the encryption key once on a trusted machine:

```sh
npm run --silent backup:keygen
```

Save the value in a password manager independently of the server. **Losing this
key makes the backups unrecoverable.** Keep old keys when rotating: old archives
still require the key that encrypted them. This is a random encryption key,
not a memorable password. Do not commit it or share it in chat.

All three secrets also accept `_FILE` alternatives for mounted Docker secrets:

```dotenv
R2_ACCESS_KEY_ID_FILE=/run/secrets/r2_access_key_id
R2_SECRET_ACCESS_KEY_FILE=/run/secrets/r2_secret_access_key
BACKUP_ENCRYPTION_KEY_FILE=/run/secrets/backup_encryption_key
```

Do not set both the inline and file form of a secret. Ensure mounted files are
readable by the container's UID 1001. Keep the SQLite volume persistent; a common
configuration is `DATABASE_URL=file:/app/data/bot.db` and a volume at `/app/data`.
This feature adds no separate persistent cache or keyring. Redeploy/recreate the
container after changing its environment; restarting alone may retain old values.

## 3. Verify a backup and restore

Build first for local commands (`npm run build`); Docker builds already do this.
These commands do not require a Discord login. Manual commands work even with
`BACKUP_ENABLED=false`, which is useful for testing before enabling scheduling.

```sh
npm run backup -- once
npm run backup -- list
```

Inside an existing container (replace `warera-bot` with its name):

```sh
docker exec warera-bot npm run backup -- once
docker exec warera-bot npm run backup -- list
```

Run manual backups outside an active scheduled upload. A separate manual process
snapshots committed database state; it cannot flush the running bot's memory.

Choose an exact key from the listing, then restore to a **new** file:

```sh
docker exec warera-bot npm run backup -- restore \
  'warera-bot/daily/2026-09-21.db.gz.enc' /app/data/restore-check.db
```

The parent directory must exist and be writable. Existing files are never
overwritten, and this command never replaces the running database. A successful
restore validates authentication, decompression, SQLite integrity, and the bot's
`Server` table. For a full recovery drill, start a separate test deployment with
this restored database and a test Discord token, or inspect expected records in
SQLite without connecting another bot to production guilds.

You can also download an encrypted object from the R2 dashboard and restore
offline. This requires only the encryption key, not R2 credentials:

```sh
npm run backup -- decrypt ./downloaded.db.gz.enc ./restored.db
```

## Recovery after losing the server

1. Recover the encryption key, deployment secrets, and the app revision/image
   compatible with the backup. Restore to a new database using the commands above.
2. Stop the bot before replacing the live database. Preserve the old database and
   any `-wal`/`-shm` files together for rollback. Do not combine a restored database
   with stale WAL/SHM files from the old one.
3. Place the verified database at the path configured by `DATABASE_URL`, set file
   ownership for UID 1001, and start the bot. Startup applies pending migrations.
4. Verify expected guild configuration and account links, then verify a new backup.

## Retention and operations

Hourly objects use unique UTC timestamp/UUID names. The first successful backup
each UTC day is copied within R2 to `daily/YYYY-MM-DD.db.gz.enc`. Existing daily
objects are preserved across restarts; only a 404 triggers creation. A daily-copy
failure fails the overall cycle but does not remove its successful hourly upload.

Uploads retry transient failures up to three times, reopening the archive stream
each time, with a two-minute timeout per attempt. Authentication errors fail
immediately. Scheduled failures are logged and retried on the next cycle; they
do not stop other bot tasks. Graceful shutdown aborts network work and waits for
snapshot/archive cleanup before closing Prisma. Temporary plaintext and encrypted
files are removed after each attempt; this implementation has no durable local
retry queue. Disk artifacts can remain after a forced kill, so avoid persistent
`TMPDIR` storage unless you also manage its cleanup.

Monitor `Database backup uploaded:` success logs and `database-backup` failure
logs. Alert through your deployment's monitoring when no successful backup has
completed within two intervals. There is no Discord notification or external
monitor provisioned by this feature. A stopped bot cannot report missing backups.

Single encrypted archives are limited to 5 GB. For larger databases use multipart
uploads or a different backup strategy. At the default retention there are roughly
168 hourly plus 30 daily archives, plus startup/manual backups and lifecycle
deletion lag. Cost depends on compressed size and the existing bucket's usage.

Archive format v1 is `WERABK01` (8 bytes), a random 12-byte nonce, gzip bytes
encrypted with AES-256-GCM, then the 16-byte GCM tag. The header is authenticated
as additional data. Keep this format documentation and the restore tool with your
recovery instructions.
