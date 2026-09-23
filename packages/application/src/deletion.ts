import type { ArchivePayload } from '@workout/contracts';
import { err, ok, type Result } from '@workout/domain';
import { exportArchive, importArchive } from './archive.js';
import type { ArchiveSink, ArchiveSource, LocalDataEraser } from './archive-ports.js';
import type { Clock } from './ports.js';

export const DELETION_RECOVERY_DAYS = 30;

export const MS_PER_DAY = 24 * 60 * 60 * 1_000;

export function recoverableUntil(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + DELETION_RECOVERY_DAYS * MS_PER_DAY);
}

export interface PendingDeletion {
  readonly userId: string;
  readonly requestedAt: Date;
  readonly recoverableUntil: Date;
  readonly archive: ArchivePayload;
}

export interface DeletionStore {
  get(userId: string): Promise<PendingDeletion | undefined>;
  put(deletion: PendingDeletion): Promise<void>;
  remove(userId: string): Promise<void>;
}

export type ScheduleDeletionError =
  | { readonly kind: 'already_pending'; readonly recoverableUntil: Date }
  | { readonly kind: 'nothing_to_delete' };

export type RecoverDeletionError =
  | { readonly kind: 'not_pending' }
  | { readonly kind: 'recovery_expired'; readonly recoverableUntil: Date }
  | { readonly kind: 'import_failed'; readonly detail: string };

export type PurgeDeletionError =
  | { readonly kind: 'not_pending' }
  | { readonly kind: 'still_recoverable'; readonly recoverableUntil: Date }
  | { readonly kind: 'not_verified' };

export interface DeletionPorts {
  readonly source: ArchiveSource;
  readonly sink: ArchiveSink;
  readonly eraser: LocalDataEraser;
  readonly deletions: DeletionStore;
  readonly clock: Clock;
}

export async function scheduleRecoverableDeletion(
  ports: DeletionPorts,
  userId: string,
): Promise<Result<PendingDeletion, ScheduleDeletionError>> {
  const existing = await ports.deletions.get(userId);
  if (existing) {
    return err({ kind: 'already_pending', recoverableUntil: existing.recoverableUntil });
  }

  const [plans, sessions] = await Promise.all([
    ports.source.plans(userId),
    ports.source.sessions(userId),
  ]);
  if (plans.length === 0 && sessions.length === 0) {
    return err({ kind: 'nothing_to_delete' });
  }

  const requestedAt = ports.clock.now();
  const archive = await exportArchive({ source: ports.source, clock: ports.clock }, userId);
  const pending: PendingDeletion = {
    userId,
    requestedAt,
    recoverableUntil: recoverableUntil(requestedAt),
    archive,
  };

  await ports.deletions.put(pending);
  await ports.eraser.clearAll(userId);
  return ok(pending);
}

export async function recoverDeletion(
  ports: DeletionPorts,
  userId: string,
): Promise<Result<{ readonly restored: PendingDeletion }, RecoverDeletionError>> {
  const pending = await ports.deletions.get(userId);
  if (!pending) return err({ kind: 'not_pending' });

  const now = ports.clock.now();
  if (now.getTime() >= pending.recoverableUntil.getTime()) {
    return err({ kind: 'recovery_expired', recoverableUntil: pending.recoverableUntil });
  }

  const imported = await importArchive(
    { sink: ports.sink, source: ports.source },
    userId,
    pending.archive,
  );
  if (!imported.ok) {
    return err({ kind: 'import_failed', detail: imported.error.kind });
  }

  await ports.deletions.remove(userId);
  return ok({ restored: pending });
}

export async function purgeExpiredDeletion(
  ports: DeletionPorts,
  userId: string,
): Promise<Result<{ readonly verifiedGone: true }, PurgeDeletionError>> {
  const pending = await ports.deletions.get(userId);
  if (!pending) return err({ kind: 'not_pending' });

  const now = ports.clock.now();
  if (now.getTime() < pending.recoverableUntil.getTime()) {
    return err({ kind: 'still_recoverable', recoverableUntil: pending.recoverableUntil });
  }

  await ports.deletions.remove(userId);
  const leftover = await ports.deletions.get(userId);
  if (leftover) return err({ kind: 'not_verified' });
  return ok({ verifiedGone: true });
}
