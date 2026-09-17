import type {
  Delivery,
  IdempotencyKey,
  LocalCommitOutcome,
  LocalCommitRequest,
  LocalWorkoutStore,
  OutboxEntry,
  PlanReader,
} from '@workout/application';
import type { ActiveSession, Plan, WorkoutSession } from '@workout/domain';

/**
 * The device workout store and outbox, on IndexedDB (ADR-0003, offline-sync spec, task 4.1).
 *
 * The contract this exists to keep is atomicity: a session and its outbox entry are written in
 * ONE readwrite transaction spanning both object stores, and `commit` resolves only after that
 * transaction completes. If the tab is killed mid-flight, IndexedDB discards the whole
 * transaction, so the device is never left holding a session whose delivery was never queued,
 * or a queued delivery for a session it does not have.
 *
 * Nothing here deletes a queued entry except `acknowledge`, which the delivery loop calls only
 * after the server accepted it (ADR-0003, AGENTS.md rule 5).
 *
 * Domain entities are plain data with `Date`s, so they are stored by structured clone as they
 * are. That is why this file imports nothing at runtime: no serialisation layer to drift from
 * the domain, and no schema to keep in step by hand.
 */

const SESSIONS = 'sessions';
const OUTBOX = 'outbox';
const KEYS = 'idempotency-keys';
const SEQUENCES = 'entity-sequences';
const PLANS = 'plans';

const BY_USER = 'by-user';
const BY_KEY = 'by-key';
const BY_USER_STATUS = 'by-user-status';

const DEFAULT_DATABASE = 'workout';
const VERSION = 1;

export interface IndexedDbOptions {
  /** One database per deployment; a test uses its own so cases cannot see each other. */
  readonly databaseName?: string;
  /** Defaults to the page's `indexedDB`. */
  readonly factory?: IDBFactory;
}

interface SessionRecord {
  readonly userId: string;
  readonly id: string;
  /** Duplicated out of the session so `activeSession` can be an index lookup. */
  readonly status: WorkoutSession['status'];
  readonly session: WorkoutSession;
}

/** An outbox entry plus what the store needs to find it. `ordinal` is the commit order. */
interface OutboxRecord {
  ordinal?: number;
  readonly userId: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly entityId: string;
  readonly sequence: number;
  readonly mutation: OutboxEntry['mutation'];
  readonly enqueuedAt: Date;
  readonly delivery: Delivery;
}

interface KeyRecord {
  readonly userId: string;
  readonly idempotencyKey: IdempotencyKey;
  /** The mutation this key named, so a reuse with a different payload is refusable. */
  readonly payload: string;
}

interface SequenceRecord {
  readonly userId: string;
  readonly entityId: string;
  readonly sequence: number;
}

interface PlanRecord {
  readonly userId: string;
  readonly plan: Plan;
}

/** The entry as the port defines it: the storage-only fields are not part of the contract. */
function toEntry(record: OutboxRecord): OutboxEntry {
  return {
    idempotencyKey: record.idempotencyKey,
    entityId: record.entityId,
    sequence: record.sequence,
    mutation: record.mutation,
    enqueuedAt: record.enqueuedAt,
    delivery: record.delivery,
  };
}

function promise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/** True for the error a full device raises, wherever IndexedDB chooses to surface it. */
function isQuotaExceeded(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'QuotaExceededError';
}

/**
 * Opens the database, creating the stores and indexes on first use.
 *
 * `onClosed` is called when this connection is dropped because another tab is upgrading the
 * schema. Holding the connection open would block that tab's upgrade indefinitely, which is
 * how a released version can leave a user unable to reach their own queued workouts - so the
 * connection is closed and reopened lazily on the next call.
 */
function openDatabase(
  name: string,
  factory: IDBFactory,
  onClosed: () => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const sessions = db.createObjectStore(SESSIONS, { keyPath: ['userId', 'id'] });
      sessions.createIndex(BY_USER_STATUS, ['userId', 'status']);
      // The key is the commit ordinal, so iterating one user's index yields commit order.
      const outbox = db.createObjectStore(OUTBOX, { keyPath: 'ordinal', autoIncrement: true });
      outbox.createIndex(BY_USER, 'userId');
      outbox.createIndex(BY_KEY, ['userId', 'idempotencyKey'], { unique: true });
      db.createObjectStore(KEYS, { keyPath: ['userId', 'idempotencyKey'] });
      db.createObjectStore(SEQUENCES, { keyPath: ['userId', 'entityId'] });
      db.createObjectStore(PLANS, { keyPath: 'userId' });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        onClosed();
      };
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('could not open the database'));
    request.onblocked = () => reject(new Error('another tab is holding an older database version'));
  });
}

class Database {
  readonly #name: string;
  readonly #factory: IDBFactory;
  #open: Promise<IDBDatabase> | undefined;

  constructor(options: IndexedDbOptions = {}) {
    this.#name = options.databaseName ?? DEFAULT_DATABASE;
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is not available in this environment');
    this.#factory = factory;
  }

  /** One connection per instance, reopened if an upgrade elsewhere closed it. */
  handle(): Promise<IDBDatabase> {
    this.#open ??= openDatabase(this.#name, this.#factory, () => {
      this.#open = undefined;
    });
    return this.#open;
  }

  async transaction<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<T> | T,
  ): Promise<T> {
    const db = await this.handle();
    const transaction = db.transaction([...stores], mode);
    // The completion promise is created before any request, so a transaction that aborts
    // between requests is still observed rather than leaving this hanging.
    const settled = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
      transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
    });
    let result: T;
    try {
      result = await work(transaction);
    } catch (error) {
      // An error inside the work must not leave earlier requests to auto-commit: IndexedDB
      // commits a transaction as soon as it goes idle, so "throw and hope" would persist a
      // half-written commit. Aborting is what makes the atomicity claim true for faults that
      // are raised in this code rather than by the browser.
      try {
        transaction.abort();
      } catch {
        // Already finished or aborting; the original error is the one worth reporting.
      }
      settled.catch(() => undefined);
      throw error;
    }
    await settled;
    return result;
  }
}

export class IndexedDbWorkoutStore implements LocalWorkoutStore {
  readonly #db: Database;

  constructor(options: IndexedDbOptions = {}) {
    this.#db = new Database(options);
  }

  /**
   * Writes the session, its outbox entry, the idempotency key, and the entity's sequence in
   * one transaction. Every read this decision depends on happens inside that same transaction,
   * so a concurrent commit cannot slip between the check and the write.
   */
  async commit(request: LocalCommitRequest): Promise<LocalCommitOutcome> {
    const payload = JSON.stringify(request.mutation);
    const entityId = request.session.id;
    try {
      return await this.#db.transaction(
        [SESSIONS, OUTBOX, KEYS, SEQUENCES],
        'readwrite',
        async (transaction) => {
          const keys = transaction.objectStore(KEYS);
          const existing = await promise<KeyRecord | undefined>(
            keys.get([request.userId, request.idempotencyKey]),
          );
          if (existing) {
            if (existing.payload !== payload) return { kind: 'idempotency_key_reused' } as const;
            const queued = await promise<OutboxRecord | undefined>(
              transaction
                .objectStore(OUTBOX)
                .index(BY_KEY)
                .get([request.userId, request.idempotencyKey]),
            );
            return queued
              ? ({ kind: 'committed', entry: toEntry(queued) } as const)
              : ({ kind: 'already_delivered' } as const);
          }

          const sequences = transaction.objectStore(SEQUENCES);
          const previous = await promise<SequenceRecord | undefined>(
            sequences.get([request.userId, entityId]),
          );
          const sequence = (previous?.sequence ?? 0) + 1;
          const record: OutboxRecord = {
            userId: request.userId,
            idempotencyKey: request.idempotencyKey,
            entityId,
            sequence,
            mutation: request.mutation,
            enqueuedAt: request.enqueuedAt,
            delivery: { state: 'queued' },
          };

          const session: SessionRecord = {
            userId: request.userId,
            id: entityId,
            status: request.session.status,
            session: request.session,
          };
          transaction.objectStore(SESSIONS).put(session);
          transaction.objectStore(OUTBOX).put(record);
          keys.put({
            userId: request.userId,
            idempotencyKey: request.idempotencyKey,
            payload,
          } satisfies KeyRecord);
          sequences.put({ userId: request.userId, entityId, sequence } satisfies SequenceRecord);
          return { kind: 'committed', entry: toEntry(record) } as const;
        },
      );
    } catch (error) {
      // A full device is an outcome the caller handles, not a crash. Anything else is a fault
      // and is re-thrown: swallowing it would report a successful commit that never happened.
      if (isQuotaExceeded(error)) return { kind: 'storage_full' };
      throw error;
    }
  }

  async activeSession(userId: string): Promise<ActiveSession | undefined> {
    const record = await this.#db.transaction([SESSIONS], 'readonly', (transaction) =>
      promise<SessionRecord | undefined>(
        transaction.objectStore(SESSIONS).index(BY_USER_STATUS).get([userId, 'active']),
      ),
    );
    if (!record) return undefined;
    const session = record.session;
    return session.status === 'active' ? session : undefined;
  }

  async findSession(userId: string, sessionId: string): Promise<WorkoutSession | undefined> {
    const record = await this.#db.transaction([SESSIONS], 'readonly', (transaction) =>
      promise<SessionRecord | undefined>(
        transaction.objectStore(SESSIONS).get([userId, sessionId]),
      ),
    );
    return record?.session;
  }

  async outbox(userId: string): Promise<readonly OutboxEntry[]> {
    const records = await this.#db.transaction([OUTBOX], 'readonly', (transaction) =>
      promise<OutboxRecord[]>(
        transaction.objectStore(OUTBOX).index(BY_USER).getAll(IDBKeyRange.only(userId)),
      ),
    );
    // getAll on an index returns index-key order, and within one user that is primary-key
    // order: the autoincrementing commit ordinal.
    return records.map(toEntry);
  }

  async updateDelivery(userId: string, key: IdempotencyKey, delivery: Delivery): Promise<void> {
    await this.#db.transaction([OUTBOX], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(OUTBOX);
      const record = await promise<OutboxRecord | undefined>(
        store.index(BY_KEY).get([userId, key]),
      );
      if (record) store.put({ ...record, delivery });
    });
  }

  async acknowledge(userId: string, key: IdempotencyKey): Promise<void> {
    await this.#db.transaction([OUTBOX], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(OUTBOX);
      const ordinal = await promise<number | undefined>(
        store.index(BY_KEY).getKey([userId, key]) as IDBRequest<number | undefined>,
      );
      if (ordinal !== undefined) store.delete(ordinal);
    });
  }
}

/**
 * The plan as last downloaded to the device (ADR-0003). `save` is what the sync path calls;
 * with nothing downloaded there is no plan, and the reader says so rather than inventing one.
 */
export class IndexedDbPlanStore implements PlanReader {
  readonly #db: Database;

  constructor(options: IndexedDbOptions = {}) {
    this.#db = new Database(options);
  }

  async activePlan(userId: string): Promise<Plan | undefined> {
    const record = await this.#db.transaction([PLANS], 'readonly', (transaction) =>
      promise<PlanRecord | undefined>(transaction.objectStore(PLANS).get(userId)),
    );
    // A superseded plan is kept for history but is not the active one.
    return record?.plan.status === 'active' ? record.plan : undefined;
  }

  async save(userId: string, plan: Plan): Promise<void> {
    await this.#db.transaction([PLANS], 'readwrite', (transaction) => {
      transaction.objectStore(PLANS).put({ userId, plan } satisfies PlanRecord);
    });
  }
}
