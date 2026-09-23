import type { DeletionStore, PendingDeletion } from '@workout/application';

const DATABASE = 'workout-pending-deletion';
const VERSION = 1;
const STORE = 'pending-deletions';

export interface DeletionDbOptions {
  readonly databaseName?: string;
  readonly factory?: IDBFactory;
}

interface PendingDeletionRecord {
  readonly userId: string;
  readonly requestedAt: Date;
  readonly recoverableUntil: Date;
  readonly archive: PendingDeletion['archive'];
}

function promise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(name: string, factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('could not open the deletion database'));
    request.onblocked = () =>
      reject(new Error('another tab is holding an older deletion database'));
  });
}

export class IndexedDbDeletionStore implements DeletionStore {
  readonly #name: string;
  readonly #factory: IDBFactory;

  constructor(options: DeletionDbOptions = {}) {
    this.#name = options.databaseName ?? DATABASE;
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is not available in this environment');
    this.#factory = factory;
  }

  async #withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T> | T,
  ): Promise<T> {
    const db = await openDatabase(this.#name, this.#factory);
    try {
      const transaction = db.transaction(STORE, mode);
      const settled = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
      });
      const result = await work(transaction.objectStore(STORE));
      await settled;
      return result;
    } finally {
      db.close();
    }
  }

  get(userId: string): Promise<PendingDeletion | undefined> {
    return this.#withStore('readonly', async (store) => {
      const record = await promise<PendingDeletionRecord | undefined>(store.get(userId));
      return record;
    });
  }

  put(deletion: PendingDeletion): Promise<void> {
    return this.#withStore('readwrite', (store) => {
      store.put({
        userId: deletion.userId,
        requestedAt: deletion.requestedAt,
        recoverableUntil: deletion.recoverableUntil,
        archive: deletion.archive,
      } satisfies PendingDeletionRecord);
    });
  }

  remove(userId: string): Promise<void> {
    return this.#withStore('readwrite', (store) => {
      store.delete(userId);
    });
  }
}
