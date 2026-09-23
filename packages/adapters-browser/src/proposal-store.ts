import type {
  CommitDecisionOutcome,
  CommitDecisionRequest,
  MarkStaleOutcome,
  ProposalStore,
  RejectOutcome,
} from '@workout/application';
import { markStale, nextRevision, type Proposal, type Revision } from '@workout/domain';

const DATABASE = 'workout-proposals';
const VERSION = 1;
const PROPOSALS = 'proposals';
const REVISIONS = 'revisions';

export interface ProposalDbOptions {
  readonly databaseName?: string;
  readonly factory?: IDBFactory;
}

interface ProposalRecord {
  readonly userId: string;
  readonly id: string;
  readonly status: Proposal['status'];
  readonly createdAt: Date;
  readonly proposal: Proposal;
}

interface RevisionRecord {
  readonly userId: string;
  readonly revision: Revision;
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
      if (!db.objectStoreNames.contains(PROPOSALS)) {
        const store = db.createObjectStore(PROPOSALS, { keyPath: ['userId', 'id'] });
        store.createIndex('by-user-status', ['userId', 'status']);
        store.createIndex('by-user', 'userId');
      }
      if (!db.objectStoreNames.contains(REVISIONS)) {
        db.createObjectStore(REVISIONS, { keyPath: 'userId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('could not open the proposal database'));
    request.onblocked = () =>
      reject(new Error('another tab is holding an older proposal database'));
  });
}

export class IndexedDbProposalStore implements ProposalStore {
  readonly #name: string;
  readonly #factory: IDBFactory;

  constructor(options: ProposalDbOptions = {}) {
    this.#name = options.databaseName ?? DATABASE;
    const factory = options.factory ?? globalThis.indexedDB;
    if (!factory) throw new Error('IndexedDB is not available in this environment');
    this.#factory = factory;
  }

  async #withStores<T>(
    stores: readonly string[],
    mode: IDBTransactionMode,
    work: (transaction: IDBTransaction) => Promise<T> | T,
  ): Promise<T> {
    const db = await openDatabase(this.#name, this.#factory);
    try {
      const transaction = db.transaction([...stores], mode);
      const settled = new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error ?? new Error('transaction aborted'));
        transaction.onerror = () => reject(transaction.error ?? new Error('transaction failed'));
      });
      const result = await work(transaction);
      await settled;
      return result;
    } finally {
      db.close();
    }
  }

  async setRevision(userId: string, revision: Revision): Promise<void> {
    await this.#withStores([REVISIONS], 'readwrite', (transaction) => {
      transaction.objectStore(REVISIONS).put({ userId, revision } satisfies RevisionRecord);
    });
  }

  async seed(userId: string, proposal: Proposal): Promise<void> {
    await this.#withStores([PROPOSALS], 'readwrite', (transaction) => {
      transaction.objectStore(PROPOSALS).put({
        userId,
        id: proposal.id,
        status: proposal.status,
        createdAt: proposal.createdAt,
        proposal,
      } satisfies ProposalRecord);
    });
  }

  async currentRevision(userId: string): Promise<Revision> {
    return this.#withStores([REVISIONS], 'readonly', async (transaction) => {
      const record = await promise<RevisionRecord | undefined>(
        transaction.objectStore(REVISIONS).get(userId),
      );
      return record?.revision ?? (1 as Revision);
    });
  }

  async findById(userId: string, proposalId: string): Promise<Proposal | undefined> {
    return this.#withStores([PROPOSALS], 'readonly', async (transaction) => {
      const record = await promise<ProposalRecord | undefined>(
        transaction.objectStore(PROPOSALS).get([userId, proposalId]),
      );
      return record?.proposal;
    });
  }

  async listPending(userId: string): Promise<readonly Proposal[]> {
    return this.#withStores([PROPOSALS], 'readonly', async (transaction) => {
      const records = await promise<ProposalRecord[]>(
        transaction
          .objectStore(PROPOSALS)
          .index('by-user-status')
          .getAll(IDBKeyRange.only([userId, 'pending'])),
      );
      return records
        .map((record) => record.proposal)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    });
  }

  async markStaleIfPending(userId: string, proposalId: string): Promise<MarkStaleOutcome> {
    return this.#withStores([PROPOSALS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(PROPOSALS);
      const record = await promise<ProposalRecord | undefined>(store.get([userId, proposalId]));
      if (!record) return 'not_found';
      if (record.proposal.status !== 'pending') return 'not_pending';
      const stale = markStale(record.proposal);
      store.put({
        ...record,
        status: stale.status,
        proposal: stale,
      } satisfies ProposalRecord);
      return 'marked';
    });
  }

  async rejectIfPending(userId: string, proposalId: string): Promise<RejectOutcome> {
    return this.#withStores([PROPOSALS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(PROPOSALS);
      const record = await promise<ProposalRecord | undefined>(store.get([userId, proposalId]));
      if (!record) return { kind: 'not_found' };
      if (record.proposal.status !== 'pending') {
        return { kind: 'not_pending', status: record.proposal.status };
      }
      const rejected: Proposal = { ...record.proposal, status: 'rejected' };
      store.put({
        ...record,
        status: rejected.status,
        proposal: rejected,
      } satisfies ProposalRecord);
      return { kind: 'rejected', proposal: rejected };
    });
  }

  async commitDecision(request: CommitDecisionRequest): Promise<CommitDecisionOutcome> {
    return this.#withStores([PROPOSALS, REVISIONS], 'readwrite', async (transaction) => {
      const proposals = transaction.objectStore(PROPOSALS);
      const revisions = transaction.objectStore(REVISIONS);
      const record = await promise<ProposalRecord | undefined>(
        proposals.get([request.userId, request.proposal.id]),
      );
      if (!record) return { kind: 'not_found' };
      if (record.proposal.status !== request.expectedStatus) {
        return { kind: 'status_changed', currentStatus: record.proposal.status };
      }

      const revisionRecord = await promise<RevisionRecord | undefined>(
        revisions.get(request.userId),
      );
      const revision = revisionRecord?.revision ?? (1 as Revision);
      if (revision !== request.expectedRevision) {
        return { kind: 'revision_changed', currentRevision: revision };
      }

      const committed = request.advanceRevision ? nextRevision(revision) : revision;
      proposals.put({
        userId: request.userId,
        id: request.proposal.id,
        status: request.proposal.status,
        createdAt: request.proposal.createdAt,
        proposal: request.proposal,
      } satisfies ProposalRecord);
      revisions.put({ userId: request.userId, revision: committed } satisfies RevisionRecord);
      return { kind: 'committed', revision: committed };
    });
  }
}
