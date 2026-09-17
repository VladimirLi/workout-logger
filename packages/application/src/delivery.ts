import type {
  Delivery,
  DeliveryFailure,
  IdempotencyKey,
  LocalWorkoutStore,
  OutboxEntry,
  WorkoutMutation,
} from './offline-ports.js';
import type { Clock } from './ports.js';

/**
 * Delivering the device outbox to the server (offline-sync spec, ADR-0003).
 *
 * - Network errors, 408, 429, and 5xx are retried; every other 4xx is a permanent failure that
 *   needs the user's attention. The entry is kept either way: nothing here discards it.
 * - Retries wait a capped exponential backoff with full jitter, and at least as long as a
 *   longer `Retry-After`.
 * - Entries drain in order per entity. An entity whose earliest entry is in flight, waiting to
 *   retry, or failed permanently holds its later entries; other entities keep draining.
 * - A retry sends the entry's stored idempotency key, never a new one.
 */

/** What one delivery attempt produced, as seen by the client. */
export type TransportResult =
  | { readonly kind: 'network_error' }
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly retryAfter?: string | undefined;
    };

export interface DeliveryRequest {
  readonly idempotencyKey: IdempotencyKey;
  readonly mutation: WorkoutMutation;
}

/** Sends one mutation to the server. Implemented over HTTP by an adapter. */
export interface WorkoutTransport {
  send(request: DeliveryRequest): Promise<TransportResult>;
}

export type DeliveryClassification =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'retry'; readonly failure: DeliveryFailure; readonly retryAfterMs?: number }
  | { readonly kind: 'permanent'; readonly failure: DeliveryFailure };

/** `Retry-After` as delay-seconds or an HTTP date, in milliseconds from now. */
export function parseRetryAfterMs(value: string | undefined, now: Date): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  if (!/[a-z]/i.test(trimmed)) return undefined;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now.getTime());
}

export function classifyDelivery(result: TransportResult, now: Date): DeliveryClassification {
  if (result.kind === 'network_error') return { kind: 'retry', failure: 'network' };
  const { status } = result;
  const failure: DeliveryFailure = `http_${status}`;
  if (status >= 200 && status < 300) return { kind: 'accepted' };
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
    const retryAfterMs = parseRetryAfterMs(result.retryAfter, now);
    return retryAfterMs === undefined
      ? { kind: 'retry', failure }
      : { kind: 'retry', failure, retryAfterMs };
  }
  // Every other status, including 1xx and 3xx that should never reach here, needs a person.
  return { kind: 'permanent', failure };
}

export interface BackoffPolicy {
  readonly baseMs: number;
  readonly capMs: number;
}

/** One second doubling per attempt, capped at five minutes. An engineering default, not policy. */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 1_000, capMs: 300_000 };

export function backoffDelayMs(options: {
  readonly attempt: number;
  readonly random: () => number;
  readonly policy?: BackoffPolicy | undefined;
  readonly retryAfterMs?: number | undefined;
}): number {
  const { baseMs, capMs } = options.policy ?? DEFAULT_BACKOFF;
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, options.attempt - 1));
  const jittered = Math.floor(options.random() * ceiling);
  return Math.max(jittered, options.retryAfterMs ?? 0);
}

/** The earliest entry of each entity, if it may be attempted now. */
export function deliverableEntries(entries: readonly OutboxEntry[], now: Date): OutboxEntry[] {
  const heads = new Map<string, OutboxEntry>();
  for (const entry of entries) {
    const head = heads.get(entry.entityId);
    if (!head || entry.sequence < head.sequence) heads.set(entry.entityId, entry);
  }
  return [...heads.values()].filter(({ delivery }) => {
    if (delivery.state === 'queued') return true;
    if (delivery.state === 'retrying') return delivery.nextAttemptAt.getTime() <= now.getTime();
    return false;
  });
}

export interface DrainPorts {
  readonly store: LocalWorkoutStore;
  readonly transport: WorkoutTransport;
  readonly clock: Clock;
  readonly random: () => number;
  readonly backoff?: BackoffPolicy;
}

export interface DrainReport {
  readonly accepted: number;
  readonly retrying: number;
  readonly needsAttention: number;
}

function attemptsOf(delivery: Delivery): number {
  return delivery.state === 'queued' ? 0 : delivery.attempts;
}

/**
 * Drains what can be delivered now. Entities are attempted in outbox order; an accepted entry
 * lets the same entity's next entry go in the same drain.
 */
export async function drainOutbox(ports: DrainPorts, userId: string): Promise<DrainReport> {
  const report = { accepted: 0, retrying: 0, needsAttention: 0 };
  const attempted = new Set<IdempotencyKey>();

  for (;;) {
    const now = ports.clock.now();
    const next = deliverableEntries(await ports.store.outbox(userId), now).find(
      (entry) => !attempted.has(entry.idempotencyKey),
    );
    if (!next) return report;
    attempted.add(next.idempotencyKey);

    const attempts = attemptsOf(next.delivery) + 1;
    await ports.store.updateDelivery(userId, next.idempotencyKey, { state: 'in_flight', attempts });
    const result = await ports.transport.send({
      idempotencyKey: next.idempotencyKey,
      mutation: next.mutation,
    });
    const classification = classifyDelivery(result, ports.clock.now());

    switch (classification.kind) {
      case 'accepted':
        await ports.store.acknowledge(userId, next.idempotencyKey);
        report.accepted += 1;
        break;
      case 'retry': {
        const delay = backoffDelayMs({
          attempt: attempts,
          random: ports.random,
          policy: ports.backoff,
          retryAfterMs: classification.retryAfterMs,
        });
        await ports.store.updateDelivery(userId, next.idempotencyKey, {
          state: 'retrying',
          attempts,
          nextAttemptAt: new Date(ports.clock.now().getTime() + delay),
          lastFailure: classification.failure,
        });
        report.retrying += 1;
        break;
      }
      case 'permanent':
        await ports.store.updateDelivery(userId, next.idempotencyKey, {
          state: 'needs_attention',
          attempts,
          lastFailure: classification.failure,
        });
        report.needsAttention += 1;
        break;
    }
  }
}
