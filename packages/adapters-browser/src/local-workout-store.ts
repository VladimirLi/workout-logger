import type {
  ArchiveSink,
  ArchiveSource,
  Delivery,
  IdempotencyKey,
  LocalCommitOutcome,
  LocalCommitRequest,
  LocalDataEraser,
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
/** Shared so the identity adapter names the same store rather than a copy of the string. */
export const IDENTITY_STORE = 'device-identity';

const BY_USER = 'by-user';
const BY_KEY = 'by-key';
const BY_USER_STATUS = 'by-user-status';
const PLAN_BY_USER_STATUS = 'plan-by-user-status';

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
  readonly id: string;
  /** Duplicated out of the plan so the active one is an index lookup. */
  readonly status: Plan['status'];
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
      // Who the device records for before anyone signs in (identity spec, task 3.6). In this
      // database, not localStorage, so the name the workouts are filed under cannot be lost
      // while the workouts remain.
      db.createObjectStore(IDENTITY_STORE, { keyPath: 'key' });
      // Keyed per plan, not per user: a superseded plan is history and is kept until the
      // user deletes it (data-portability spec), so it cannot be overwritten by its successor.
      const plans = db.createObjectStore(PLANS, { keyPath: ['userId', 'id'] });
      plans.createIndex(PLAN_BY_USER_STATUS, ['userId', 'status']);
      plans.createIndex(BY_USER, 'userId');
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

/**
 * The shared database handle, for the adapters in this package that are not the outbox.
 *
 * Exported inside the package rather than re-implemented, so every adapter opens the same
 * schema at the same version and a transaction can span the stores it needs.
 */
export async function openWorkoutDatabase(options: IndexedDbOptions = {}): Promise<{
  transaction: <T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    work: (
      transaction: IDBTransaction,
      request: <R>(request: IDBRequest<R>) => Promise<R>,
    ) => Promise<T> | T,
  ) => Promise<T>;
}> {
  const database = new Database(options);
  return {
    transaction: (stores, mode, work) =>
      database.transaction(stores, mode, (transaction) => work(transaction, promise)),
  };
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

  /**
   * Discards a session and everything queued for it, in one transaction (task 5.3).
   *
   * The idempotency keys are kept. They are the record that those changes were once made, and
   * dropping them would let a replay of the same key look like a new change.
   */
  async discardSession(userId: string, sessionId: string): Promise<void> {
    await this.#db.transaction([SESSIONS, OUTBOX], 'readwrite', async (transaction) => {
      transaction.objectStore(SESSIONS).delete([userId, sessionId]);
      const outbox = transaction.objectStore(OUTBOX);
      const entries = await promise<OutboxRecord[]>(
        outbox.index(BY_USER).getAll(IDBKeyRange.only(userId)),
      );
      for (const entry of entries) {
        if (entry.entityId === sessionId && entry.ordinal !== undefined) {
          outbox.delete(entry.ordinal);
        }
      }
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
      promise<PlanRecord | undefined>(
        transaction.objectStore(PLANS).index(PLAN_BY_USER_STATUS).get([userId, 'active']),
      ),
    );
    // A superseded plan is kept for history but is not the active one.
    return record?.plan.status === 'active' ? record.plan : undefined;
  }

  async save(userId: string, plan: Plan): Promise<void> {
    await this.#db.transaction([PLANS], 'readwrite', (transaction) => {
      transaction
        .objectStore(PLANS)
        .put({ userId, id: plan.id, status: plan.status, plan } satisfies PlanRecord);
    });
  }
}

/**
 * Everything on the device, for export and for restoring an export (tasks 8.1 and 8.2).
 *
 * A separate class over the same database: exporting reads all of history, which is a
 * different concern from logging a set, and the outbox port deliberately has no way to do it.
 */
export class IndexedDbArchive implements ArchiveSource, ArchiveSink, LocalDataEraser {
  readonly #db: Database;

  constructor(options: IndexedDbOptions = {}) {
    this.#db = new Database(options);
  }

  async plans(userId: string): Promise<readonly Plan[]> {
    const records = await this.#db.transaction([PLANS], 'readonly', (transaction) =>
      promise<PlanRecord[]>(
        transaction.objectStore(PLANS).index(BY_USER).getAll(IDBKeyRange.only(userId)),
      ),
    );
    return records.map((record) => record.plan);
  }

  async sessions(userId: string): Promise<readonly WorkoutSession[]> {
    const records = await this.#db.transaction([SESSIONS], 'readonly', (transaction) =>
      promise<SessionRecord[]>(
        transaction
          .objectStore(SESSIONS)
          .index(BY_USER_STATUS)
          .getAll(IDBKeyRange.bound([userId, ''], [userId, '\uffff'])),
      ),
    );
    return records.map((record) => record.session);
  }

  async putPlan(userId: string, plan: Plan): Promise<void> {
    await this.#db.transaction([PLANS], 'readwrite', (transaction) => {
      transaction
        .objectStore(PLANS)
        .put({ userId, id: plan.id, status: plan.status, plan } satisfies PlanRecord);
    });
  }

  /**
   * Restores a session without an outbox entry, because an import is not a change the server
   * has yet to hear about: the data came from an export of data it already has, or from a
   * device the user is replacing. Queueing it would deliver everything twice.
   */
  async putSession(userId: string, session: WorkoutSession): Promise<void> {
    await this.#db.transaction([SESSIONS], 'readwrite', (transaction) => {
      transaction.objectStore(SESSIONS).put({
        userId,
        id: session.id,
        status: session.status,
        session,
      } satisfies SessionRecord);
    });
  }

  /**
   * Moves every record for one identity to another, in a single transaction (task 3.7).
   *
   * The account claiming a device's data is the reason this exists. Each store's key begins
   * with the identity, so the record has to be written under the new key and the old one
   * removed - which is why it is one transaction: a partial rekey would leave a session under
   * one identity and its queue entry under another, and the outbox guarantee would be gone.
   *
   * Nothing is discarded. The count of outbox entries afterwards is the count before, and a
   * test requires it.
   */
  async rekey(fromUserId: string, toUserId: string): Promise<void> {
    if (fromUserId === toUserId) return;
    await this.#db.transaction(
      [SESSIONS, OUTBOX, KEYS, SEQUENCES, PLANS],
      'readwrite',
      async (transaction) => {
        const spanning = IDBKeyRange.bound([fromUserId, ''], [fromUserId, '\uffff']);

        const sessions = transaction.objectStore(SESSIONS);
        for (const record of await promise<SessionRecord[]>(sessions.getAll(spanning))) {
          sessions.delete([fromUserId, record.id]);
          sessions.put({ ...record, userId: toUserId });
        }

        const plans = transaction.objectStore(PLANS);
        for (const record of await promise<PlanRecord[]>(plans.getAll(spanning))) {
          plans.delete([fromUserId, record.id]);
          plans.put({ ...record, userId: toUserId });
        }

        const keys = transaction.objectStore(KEYS);
        for (const record of await promise<KeyRecord[]>(keys.getAll(spanning))) {
          keys.delete([fromUserId, record.idempotencyKey]);
          keys.put({ ...record, userId: toUserId });
        }

        const sequences = transaction.objectStore(SEQUENCES);
        for (const record of await promise<SequenceRecord[]>(sequences.getAll(spanning))) {
          sequences.delete([fromUserId, record.entityId]);
          sequences.put({ ...record, userId: toUserId });
        }

        // The outbox keeps its ordinal, so commit order survives the move.
        const outbox = transaction.objectStore(OUTBOX);
        const entries = await promise<OutboxRecord[]>(
          outbox.index(BY_USER).getAll(IDBKeyRange.only(fromUserId)),
        );
        for (const record of entries) outbox.put({ ...record, userId: toUserId });
      },
    );
  }

  /**
   * Erases one user's data, queue included, in a single transaction (task 4.9).
   *
   * This is the only place the outbox is emptied other than `acknowledge`, and it is reachable
   * only through `clearLocalDataAfterExport`, which takes the export first. One transaction,
   * so an interrupted clear does not leave sessions whose queue entries are gone.
   */
  async clearAll(userId: string): Promise<void> {
    await this.#db.transaction(
      [SESSIONS, OUTBOX, KEYS, SEQUENCES, PLANS],
      'readwrite',
      async (transaction) => {
        const byUser = async (store: string, index: string, range: IDBKeyRange) => {
          const target = transaction.objectStore(store);
          const keys = await promise<IDBValidKey[]>(target.index(index).getAllKeys(range));
          for (const key of keys) target.delete(key);
        };
        const only = IDBKeyRange.only(userId);
        const spanning = IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
        await byUser(SESSIONS, BY_USER_STATUS, spanning);
        await byUser(OUTBOX, BY_USER, only);
        await byUser(PLANS, BY_USER, only);
        // These two have no index: their key path starts with the user, so a bounded range
        // over the primary key is the whole set for that user.
        for (const store of [KEYS, SEQUENCES]) {
          const target = transaction.objectStore(store);
          const keys = await promise<IDBValidKey[]>(target.getAllKeys(spanning));
          for (const key of keys) target.delete(key);
        }
      },
    );
  }
}
