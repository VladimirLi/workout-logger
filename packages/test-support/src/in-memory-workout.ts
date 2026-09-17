import type {
  ArchiveSink,
  ArchiveSource,
  Delivery,
  IdempotencyKey,
  IdempotencyKeys,
  Ids,
  LocalCommitOutcome,
  LocalCommitRequest,
  LocalDataEraser,
  LocalWorkoutStore,
  OutboxEntry,
  PlanReader,
  WorkoutPorts,
} from '@workout/application';
import type { ActiveSession, Plan, WorkoutSession } from '@workout/domain';
import { FixedClock } from './in-memory-ports.js';

/**
 * In-memory reference for the device workout store and outbox (ADR-0003, ADR-0005).
 *
 * The browser adapter (IndexedDB) must pass the same contract suite. Atomicity here comes from
 * applying the session and the entry in one synchronous step, with no await in between.
 */
export class InMemoryLocalWorkoutStore
  implements LocalWorkoutStore, ArchiveSource, ArchiveSink, LocalDataEraser
{
  readonly #sessions = new Map<string, WorkoutSession>();
  readonly #outbox = new Map<string, OutboxEntry[]>();
  /** Every key ever committed, with the mutation it named, including acknowledged ones. */
  readonly #keys = new Map<string, string>();
  readonly #sequences = new Map<string, number>();
  /** Plans held for export and import; the reader below is the port screens use. */
  readonly #plans = new Map<string, Plan[]>();
  #failNext: 'storage_full' | undefined;

  #sessionKey(userId: string, sessionId: string): string {
    return `${userId}::${sessionId}`;
  }

  /** Makes the next commit fail as a full device would, writing nothing. */
  failNextCommitWith(failure: 'storage_full'): void {
    this.#failNext = failure;
  }

  commit(request: LocalCommitRequest): Promise<LocalCommitOutcome> {
    if (this.#failNext) {
      const kind = this.#failNext;
      this.#failNext = undefined;
      return Promise.resolve({ kind });
    }

    const payload = JSON.stringify(request.mutation);
    const scopedKey = `${request.userId}::${request.idempotencyKey}`;
    const previous = this.#keys.get(scopedKey);
    if (previous !== undefined) {
      if (previous !== payload) return Promise.resolve({ kind: 'idempotency_key_reused' });
      const queued = this.#queue(request.userId).find(
        (entry) => entry.idempotencyKey === request.idempotencyKey,
      );
      if (queued) return Promise.resolve({ kind: 'committed', entry: queued });
      return Promise.resolve({ kind: 'already_delivered' });
    }

    const entityKey = this.#sessionKey(request.userId, request.session.id);
    const sequence = (this.#sequences.get(entityKey) ?? 0) + 1;
    const entry: OutboxEntry = {
      idempotencyKey: request.idempotencyKey,
      entityId: request.session.id,
      sequence,
      mutation: request.mutation,
      enqueuedAt: request.enqueuedAt,
      delivery: { state: 'queued' },
    };

    // One synchronous step: the session, the entry, and the key are applied together.
    this.#sessions.set(entityKey, request.session);
    this.#queue(request.userId).push(entry);
    this.#keys.set(scopedKey, payload);
    this.#sequences.set(entityKey, sequence);
    return Promise.resolve({ kind: 'committed', entry });
  }

  #queue(userId: string): OutboxEntry[] {
    let queue = this.#outbox.get(userId);
    if (!queue) {
      queue = [];
      this.#outbox.set(userId, queue);
    }
    return queue;
  }

  activeSession(userId: string): Promise<ActiveSession | undefined> {
    for (const [key, session] of this.#sessions) {
      if (key.startsWith(`${userId}::`) && session.status === 'active')
        return Promise.resolve(session);
    }
    return Promise.resolve(undefined);
  }

  findSession(userId: string, sessionId: string): Promise<WorkoutSession | undefined> {
    return Promise.resolve(this.#sessions.get(this.#sessionKey(userId, sessionId)));
  }

  outbox(userId: string): Promise<readonly OutboxEntry[]> {
    return Promise.resolve([...this.#queue(userId)]);
  }

  updateDelivery(userId: string, key: IdempotencyKey, delivery: Delivery): Promise<void> {
    const queue = this.#queue(userId);
    const index = queue.findIndex((entry) => entry.idempotencyKey === key);
    const existing = queue[index];
    if (existing) queue[index] = { ...existing, delivery };
    return Promise.resolve();
  }

  acknowledge(userId: string, key: IdempotencyKey): Promise<void> {
    const queue = this.#queue(userId);
    const index = queue.findIndex((entry) => entry.idempotencyKey === key);
    if (index >= 0) queue.splice(index, 1);
    return Promise.resolve();
  }

  // The archive ports (tasks 8.1 and 8.2). Reading all history is a different concern from
  // logging, so it is a separate port that this reference also happens to satisfy.

  sessions(userId: string): Promise<readonly WorkoutSession[]> {
    const prefix = `${userId}::`;
    return Promise.resolve(
      [...this.#sessions].filter(([key]) => key.startsWith(prefix)).map(([, session]) => session),
    );
  }

  plans(userId: string): Promise<readonly Plan[]> {
    return Promise.resolve([...(this.#plans.get(userId) ?? [])]);
  }

  putSession(userId: string, session: WorkoutSession): Promise<void> {
    this.#sessions.set(this.#sessionKey(userId, session.id), session);
    return Promise.resolve();
  }

  putPlan(userId: string, plan: Plan): Promise<void> {
    const plans = this.#plans.get(userId) ?? [];
    plans.push(plan);
    this.#plans.set(userId, plans);
    return Promise.resolve();
  }

  /** Everything for one user, including the queue: only the pre-destructive export path. */
  clearAll(userId: string): Promise<void> {
    const prefix = `${userId}::`;
    for (const key of [...this.#sessions.keys()]) {
      if (key.startsWith(prefix)) this.#sessions.delete(key);
    }
    for (const key of [...this.#keys.keys()]) {
      if (key.startsWith(prefix)) this.#keys.delete(key);
    }
    for (const key of [...this.#sequences.keys()]) {
      if (key.startsWith(prefix)) this.#sequences.delete(key);
    }
    this.#outbox.delete(userId);
    this.#plans.delete(userId);
    return Promise.resolve();
  }
}

export class InMemoryPlanReader implements PlanReader {
  readonly #plans = new Map<string, Plan>();

  setActivePlan(userId: string, plan: Plan): void {
    this.#plans.set(userId, plan);
  }

  activePlan(userId: string): Promise<Plan | undefined> {
    const plan = this.#plans.get(userId);
    return Promise.resolve(plan?.status === 'active' ? plan : undefined);
  }
}

/** Deterministic UUIDs: 00000000-0000-4000-8000-000000000001, ...002, and so on. */
export class SequentialIdempotencyKeys implements IdempotencyKeys {
  #count = 0;

  next(): IdempotencyKey {
    this.#count += 1;
    return `00000000-0000-4000-8000-${String(this.#count).padStart(12, '0')}` as IdempotencyKey;
  }
}

export class SequentialIds implements Ids {
  #count = 0;

  next(): string {
    this.#count += 1;
    return `id-${this.#count}`;
  }
}

export interface WorkoutTestPorts extends WorkoutPorts {
  readonly store: InMemoryLocalWorkoutStore;
  readonly plans: InMemoryPlanReader;
  readonly clock: FixedClock;
}

export function createWorkoutTestPorts(now: Date): WorkoutTestPorts {
  return {
    store: new InMemoryLocalWorkoutStore(),
    plans: new InMemoryPlanReader(),
    clock: new FixedClock(now),
    keys: new SequentialIdempotencyKeys(),
    ids: new SequentialIds(),
  };
}
