# Runbook: pre-migration backup

**Status:** Written, never executed. Depends on [external-gates.md](../external-gates.md),
G-2 and G-8.

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

## Before onboarding any external user

The accepted risk above stops being acceptable the moment someone else's data is involved.
Define scheduled backups, numeric RPO and RTO, and a retention schedule **before** that
happens (R-015).

If media storage is ever introduced it needs its own backup path — database backups do not
include storage objects.
