import type { ActiveSession, Plan, RecordedSet, Result, WorkoutSession } from '@workout/domain';
import { err, ok } from '@workout/domain';

/**
 * Offline durability ports (ADR-0003, offline-sync spec).
 *
 * The device is the first place a workout fact is saved. Every change is written together with
 * an outbox entry that carries a stable idempotency key, and the entry is what later reaches
 * the server, in order per entity. These ports describe that without naming IndexedDB, HTTP, or
 * any provider (ADR-0001, ADR-0005).
 */

declare const idempotencyKeyBrand: unique symbol;

/** A client-generated UUID naming one logical operation, preserved across every retry. */
export type IdempotencyKey = string & { readonly [idempotencyKeyBrand]: 'IdempotencyKey' };

export type IdempotencyKeyError = { readonly kind: 'not_a_uuid'; readonly received: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idempotencyKey(value: string): Result<IdempotencyKey, IdempotencyKeyError> {
  return UUID.test(value)
    ? ok(value as IdempotencyKey)
    : err({ kind: 'not_a_uuid', received: value });
}

/**
 * Generates new keys, as random UUIDs in the device adapter. A retry never asks for a new key:
 * it reuses the one stored with the outbox entry.
 */
export interface IdempotencyKeys {
  next(): IdempotencyKey;
}

/** Generates ids for new sessions and sets. */
export interface Ids {
  next(): string;
}

/** The changes a device records while logging, each delivered to the server exactly once. */
export type WorkoutMutation =
  | { readonly kind: 'start_session'; readonly session: ActiveSession }
  | { readonly kind: 'record_set'; readonly sessionId: string; readonly set: RecordedSet }
  | { readonly kind: 'complete_session'; readonly sessionId: string; readonly completedAt: Date };

export type DeliveryFailure = 'network' | `http_${number}`;

/** Where one outbox entry is in its delivery. Delivered entries leave the outbox. */
export type Delivery =
  | { readonly state: 'queued' }
  | { readonly state: 'in_flight'; readonly attempts: number }
  | {
      readonly state: 'retrying';
      readonly attempts: number;
      readonly nextAttemptAt: Date;
      readonly lastFailure: DeliveryFailure;
    }
  /** A permanent failure. Never discarded automatically; the user decides. */
  | {
      readonly state: 'needs_attention';
      readonly attempts: number;
      readonly lastFailure: DeliveryFailure;
    };

export interface OutboxEntry {
  readonly idempotencyKey: IdempotencyKey;
  /** The entity whose mutations drain in order: the workout session id. */
  readonly entityId: string;
  /** Order within the entity, assigned by the store at commit, starting at 1. */
  readonly sequence: number;
  readonly mutation: WorkoutMutation;
  readonly enqueuedAt: Date;
  readonly delivery: Delivery;
}

export interface LocalCommitRequest {
  readonly userId: string;
  /** The session exactly as it should be stored after this change. */
  readonly session: WorkoutSession;
  readonly mutation: WorkoutMutation;
  readonly idempotencyKey: IdempotencyKey;
  readonly enqueuedAt: Date;
}

export type LocalCommitOutcome =
  | { readonly kind: 'committed'; readonly entry: OutboxEntry }
  /** The device is out of storage. Nothing was written; queued mutations are untouched. */
  | { readonly kind: 'storage_full' }
  /** The key was already used for a different change. Nothing was written. */
  | { readonly kind: 'idempotency_key_reused' }
  /** This exact change was already delivered and acknowledged. Nothing was written again. */
  | { readonly kind: 'already_delivered' };

/**
 * The device's workout store and outbox.
 *
 * `commit` MUST write the session and its outbox entry in ONE atomic step: after any failure or
 * termination either both exist or neither does. An implementation that writes them as two
 * separate operations does not satisfy this contract, however carefully it is sequenced.
 *
 * Nothing on this port discards a queued entry except `acknowledge`, which is called only after
 * the server has accepted it. There is deliberately no method to drop a failed entry.
 */
export interface LocalWorkoutStore {
  commit(request: LocalCommitRequest): Promise<LocalCommitOutcome>;
  activeSession(userId: string): Promise<ActiveSession | undefined>;
  findSession(userId: string, sessionId: string): Promise<WorkoutSession | undefined>;
  /** Every entry still to be delivered, in commit order. */
  outbox(userId: string): Promise<readonly OutboxEntry[]>;
  /** Records a delivery attempt's result for a queued entry. */
  updateDelivery(userId: string, key: IdempotencyKey, delivery: Delivery): Promise<void>;
  /** Removes an entry the server has accepted. */
  acknowledge(userId: string, key: IdempotencyKey): Promise<void>;
}

/** The plan as last downloaded to the device. */
export interface PlanReader {
  activePlan(userId: string): Promise<Plan | undefined>;
}

export type SyncState = 'saved_on_device' | 'syncing' | 'needs_attention';

/**
 * The three user-visible sync states, and only three (ADR-0003), for one entity's pending
 * entries. Undefined means nothing is pending.
 */
export function deriveSyncState(entries: readonly OutboxEntry[]): SyncState | undefined {
  if (entries.length === 0) return undefined;
  if (entries.some((entry) => entry.delivery.state === 'needs_attention')) return 'needs_attention';
  if (entries.some((entry) => entry.delivery.state !== 'queued')) return 'syncing';
  return 'saved_on_device';
}
