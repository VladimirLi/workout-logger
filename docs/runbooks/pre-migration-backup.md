# Runbook: pre-migration backup

**Status:** Executable, not yet drilled. `scripts/pre-migration-backup.sh` and the
`database-migrate` workflow implement the steps below, and `scripts/pre-migration-backup-rehearsal.sh`
exercises them against a scratch Postgres (run locally on 2026-09-30, and by the
`backup-rehearsal` workflow). No dump has been taken from the development project, stored in a
bucket, or restored from one, because the credentials and the bucket do not exist yet. The
restore drill record below is empty until that happens. Depends on
[external-gates.md](../external-gates.md), G-2 and G-8.

## Why this exists

There is **no paid PITR and no scheduled backup** while Vladimir is the sole user (R-015).
Loss of server-side data created *between* migrations is explicitly accepted. This runbook
protects one thing only: recovery from a migration that goes wrong.

That makes it the single point of failure for the entire data-protection story. It must **fail
closed**.

## Before every production migration

Every step is mandatory. If any step fails, **do not migrate.**

1. **Create an encrypted logical dump.**
   `pg_dump` in a format you have actually restored before, encrypted at rest.
2. **Store it outside the application provider.** A backup living inside the platform whose
   migration you are about to run is not a backup of that platform.
3. **Verify it is readable.** Not that the file exists — that it restores. Restore it into a
   throwaway database and confirm row counts on the tables the migration touches.
4. **Record its checksum against the release.** SHA-256 of the dump, bound to the release
   identifier, so "which backup corresponds to this deploy?" has one answer.
5. **Fail closed.** If dump, upload, verification, or checksum recording fails, abort. Do not
   proceed with an unverified backup.

## How the steps are implemented

`database-migrate.yml` has two jobs. `migrate` declares `needs: backup`, so a failed, cancelled
or skipped backup means no migration. There is no input that skips the backup. The workflow
takes an `environment` and a `release`; only `development` exists.

`scripts/pre-migration-backup.sh backup --release <id>` does steps 1 to 5:

1. Counts rows in every table of `public`, dumps `public` with `pg_dump --format=custom`, and
   counts again. If the counts differ, something wrote during the dump and it aborts.
2. Restores the dump into a freshly created database on a **throwaway** server and requires the
   same row counts. It refuses a restore target on a Supabase host or on the source's host.
3. Encrypts the dump, the `auth.users` ids and the counts as one bundle to an
   [age](https://github.com/FiloSottile/age) public key.
4. Uploads the ciphertext to an S3-compatible bucket, downloads it back and compares SHA-256.
5. Uploads a manifest next to it and prints it. The manifest binds the ciphertext SHA-256 to the
   release: `<store>/<release>/<UTC timestamp>.tar.age` and `.json`. The job also publishes the
   SHA-256 as a job output and step summary, and keeps `manifest.json` as a workflow artifact for
   90 days. The workflow record, not the bucket, is the trusted copy of the checksum.

Any failing command exits non-zero, prints no manifest and removes the plaintext working files.

`scripts/pre-migration-backup.sh restore --release <id> [--expect-sha256 <hex>]` is the drill. It
fetches the latest manifest for the release, checks the artifact against the manifest (and against
`--expect-sha256`, the checksum recorded by the backup job), decrypts with the private key,
restores into a throwaway database and compares row counts. It prints the drill record.

**Scope.** `public` only. `auth` is managed by Supabase and the migration role cannot write to
it, so it is not dumped: only the user ids are carried, so the foreign keys to `auth.users`
restore. Storage objects are out of scope (see the last section). Grants and ownership are not
restored from the dump; migrations re-derive them, and `scripts/check-db-boundary.mjs` checks
the deployed result.

**First deploy to an empty database.** The script refuses a source with no tables, because a
backup that verifies nothing must not pass. A first deploy into an empty database has nothing to
lose; it is a human decision, not a flag.

**Not covered.** `age` cannot tell whose key a file was encrypted to, so a mistyped but valid
recipient produces backups nobody can open. The only proof is a drill with the private key;
in development the job proves it on every run (`BACKUP_AGE_IDENTITY`), in production it is the
periodic drill. Encryption protects the dump from the bucket's operator, not from whoever holds
both the bucket credential and the private key: keep the private key offline and separate.

## Credentials

Nothing here exists yet. Vladimir creates each item; an agent must not.

| Item | Where | Notes |
|---|---|---|
| Off-platform bucket | any S3-compatible store (Backblaze B2 or Cloudflare R2 fit: pennies a month at this size) | Not Supabase, not Vercel. Prefer a key that can write and read but not delete, and enable object lock or versioning where offered |
| `BACKUP_STORE_URL` | environment secret | `s3://<bucket>/<prefix>` |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | environment secrets | The bucket key |
| `AWS_ENDPOINT_URL`, `AWS_DEFAULT_REGION` | environment variables | The store's S3 endpoint and region |
| `BACKUP_AGE_RECIPIENT` | environment variable | Public key from `age-keygen` |
| `BACKUP_AGE_IDENTITY` | development environment secret **only** | The matching private key. Production's stays offline |
| `BACKUP_SOURCE_URL` | environment secret | Connection URL for `ci_backup`, below |
| `MIGRATION_DATABASE_URL` | environment secret | Connection URL for `ci_migrator`, below |

GitHub runners have no IPv6, and Supabase's direct host is IPv6 only, so use the **session
pooler** URL (port 5432). Through it a role is addressed as `<role>.<project-ref>`. Do not use
transaction mode (6543): `pg_dump` and `db push` need a session.

**Migration-only credential.** Two dedicated database roles per environment, created once by a
human with the `postgres` role in the SQL editor. Neither is the service key: that key is a
runtime API credential for reading and writing user data, and CI must not hold it. Neither
role is used by the application.

```sql
-- Dump: read-only.
CREATE ROLE ci_backup LOGIN CONNECTION LIMIT 2 PASSWORD '<generated, 32+ characters>';
GRANT pg_read_all_data TO ci_backup;
ALTER ROLE ci_backup SET default_transaction_read_only = on;

-- Migrations: can change the schema, cannot be used by the app or the API.
CREATE ROLE ci_migrator LOGIN CONNECTION LIMIT 2 PASSWORD '<generated, 32+ characters>';
GRANT postgres TO ci_migrator;
ALTER ROLE ci_migrator SET role = postgres;
```

Why `ci_migrator` is a member of `postgres`: every migration that defines a boundary function
ends with `ALTER FUNCTION ... OWNER TO postgres`, and `check-db-boundary.mjs` requires it
(ADR-0012, I-4). A role that cannot become `postgres` cannot apply them, and `SET role` makes
new objects owned by `postgres` as before. What it buys is a credential that is separate,
connection-limited, revocable on its own, absent from the app, and stored only in a GitHub
environment. Narrowing it further needs an ADR. Not yet verified against Supabase: that
`postgres` may grant itself and `pg_read_all_data` to a new role, and that `SET role` applies
through the pooler. The first development drill settles both; if either fails, that is a finding
for Vladimir, not a reason to fall back to the service key.

Rotate both passwords after any drill that a person other than Vladimir ran, and whenever a
secret may have leaked. Production gets its own roles, secrets and environment, created by
Vladimir under G-9, never copied from development.

## Migration sequence (R-016, R-017)

1. Deploy the backward-compatible **expansion**.
2. Migrate data.
3. Deploy the application.
4. Run synthetic verification (D-045).
5. **Contract only in a later release**, and only after telemetry proves the old
   application/schema path is unused.

Non-concurrent DDL runs transactionally. Potentially blocking migrations set short
`lock_timeout` and `statement_timeout` and **fail rather than queue** application traffic.
`pnpm test:migrations` enforces both.

## On failure

- **Application failure:** roll the application back and **keep the expanded schema**. The
  expansion is backward compatible; that is the point of expanding first.
- **Destructive data error:** recover through a reviewed forward fix, or a verified restore
  from the dump above.
- **Never use automatic down-migrations.** A down-migration that runs unattended against
  production data is a second chance to destroy the same data. `pnpm test:migrations` rejects
  them.

## Restore drill

Restore a retained dump into an isolated project **periodically**, not only when something
breaks. A backup path that has never been exercised is a hypothesis.

Record each drill: date, dump checksum, restore duration, and whether row counts matched.
Run it with the `restore-drill` workflow (development) or `restore` by hand. Whoever ran a drill
cannot sign it off; the QA Engineer verifies the record against the workflow run.

| Date | Environment | Release | SHA-256 | Duration | Row counts | Matched | Ran by | Verified by |
|---|---|---|---|---|---|---|---|---|
| none yet | | | | | | | | |

Rehearsal, not a drill: 2026-09-30, scratch Postgres 18 on a laptop with the committed
migrations applied and a local stand-in for the bucket. It proved the script's logic and its
refusals. It did not touch Supabase, S3 or a CI runner, so it does not close G-8.

## Before onboarding any external user

The accepted risk above stops being acceptable the moment someone else's data is involved.
Define scheduled backups, numeric RPO and RTO, and a retention schedule **before** that
happens (R-015).

If media storage is ever introduced it needs its own backup path — database backups do not
include storage objects.
