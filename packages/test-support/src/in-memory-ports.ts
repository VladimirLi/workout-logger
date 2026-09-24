import type {
  Clock,
  CommitDecisionOutcome,
  CommitDecisionRequest,
  CreatePendingOutcome,
  CreatePendingRequest,
  MarkStaleOutcome,
  Ports,
  ProposalStore,
  RejectOutcome,
} from '@workout/application';
import {
  markStale,
  nextRevision,
  type Proposal,
  type Revision,
  sameRevision,
} from '@workout/domain';
import { aRevision } from './builders.js';

/**
 * In-memory port implementations.
 *
 * These are a reference implementation, not a mock: the adapter contract suite runs
 * against these AND against a real adapter, so "the same behaviour" is a runnable
 * claim rather than a hope (ADR-0005).
 */

export class InMemoryProposalStore implements ProposalStore {
  readonly #proposals = new Map<string, Proposal>();
  readonly #revisions = new Map<string, Revision>();
  #beforeCommit: (() => void) | undefined;
  #beforeMarkStale: (() => void) | undefined;
  #beforeReject: (() => void) | undefined;

  #key(userId: string, proposalId: string): string {
    return `${userId}::${proposalId}`;
  }

  setRevision(userId: string, value: Revision): void {
    this.#revisions.set(userId, value);
  }

  seed(userId: string, proposal: Proposal): void {
    this.#proposals.set(this.#key(userId, proposal.id), proposal);
  }

  /**
   * Fires once, inside the commit window, immediately before the compare-and-set is
   * evaluated. Lets a test simulate another actor committing at the worst possible
   * moment, deterministically and without real concurrency.
   */
  onBeforeCommit(hook: () => void): void {
    this.#beforeCommit = hook;
  }

  /**
   * Fires once, immediately before the status-only stale transition, so a test can
   * move the revision again at the exact moment that used to defeat it.
   */
  /**
   * Fires once, immediately before the status-only rejection, so a test can move the
   * revision - or decide the proposal some other way - at exactly that moment.
   */
  onBeforeReject(hook: () => void): void {
    this.#beforeReject = hook;
  }

  onBeforeMarkStale(hook: () => void): void {
    this.#beforeMarkStale = hook;
  }

  currentRevision(userId: string): Promise<Revision> {
    return Promise.resolve(this.#revisions.get(userId) ?? aRevision(1));
  }

  findById(userId: string, proposalId: string): Promise<Proposal | undefined> {
    return Promise.resolve(this.#proposals.get(this.#key(userId, proposalId)));
  }

  listPending(userId: string): Promise<readonly Proposal[]> {
    const prefix = `${userId}::`;
    const pending = [...this.#proposals.entries()]
      .filter(([key, proposal]) => key.startsWith(prefix) && proposal.status === 'pending')
      .map(([, proposal]) => proposal)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return Promise.resolve(pending);
  }

  createPending(request: CreatePendingRequest): Promise<CreatePendingOutcome> {
    if (request.proposal.status !== 'pending') {
      throw new Error('createPending only records pending proposals');
    }
    const current = this.#revisions.get(request.userId) ?? aRevision(1);
    if (!sameRevision(request.proposal.baseRevision, current)) {
      return Promise.resolve({
        kind: 'stale_base_revision',
        baseRevision: request.proposal.baseRevision,
        currentRevision: current,
      });
    }
    this.#proposals.set(this.#key(request.userId, request.proposal.id), request.proposal);
    return Promise.resolve({ kind: 'created', proposal: request.proposal });
  }

  /**
   * Status-only transition. It reads and writes the proposal record and never looks
   * at the revision, which is the whole point: staleness stays true no matter what
   * the plan does next.
   */
  markStaleIfPending(userId: string, proposalId: string): Promise<MarkStaleOutcome> {
    const hook = this.#beforeMarkStale;
    if (hook) {
      this.#beforeMarkStale = undefined;
      hook();
    }

    const key = this.#key(userId, proposalId);
    const stored = this.#proposals.get(key);

    if (!stored) return Promise.resolve('not_found');
    if (stored.status !== 'pending') return Promise.resolve('not_pending');

    this.#proposals.set(key, markStale(stored));
    return Promise.resolve('marked');
  }

  /**
   * Status-only compare-and-set from pending to rejected. Never looks at the revision.
   */
  rejectIfPending(userId: string, proposalId: string): Promise<RejectOutcome> {
    const hook = this.#beforeReject;
    if (hook) {
      this.#beforeReject = undefined;
      hook();
    }

    const key = this.#key(userId, proposalId);
    const stored = this.#proposals.get(key);

    if (!stored) return Promise.resolve({ kind: 'not_found' });
    if (stored.status !== 'pending') {
      return Promise.resolve({ kind: 'not_pending', status: stored.status });
    }

    const rejected: Proposal = { ...stored, status: 'rejected' };
    this.#proposals.set(key, rejected);
    return Promise.resolve({ kind: 'rejected', proposal: rejected });
  }

  /**
   * Compare-and-set, evaluated and applied with no await in between, so nothing can
   * interleave. A real adapter gets this from one database transaction; here it
   * comes from the single-threaded event loop.
   */
  commitDecision(request: CommitDecisionRequest): Promise<CommitDecisionOutcome> {
    const hook = this.#beforeCommit;
    if (hook) {
      this.#beforeCommit = undefined;
      hook();
    }

    const key = this.#key(request.userId, request.proposal.id);
    const stored = this.#proposals.get(key);

    if (!stored) {
      return Promise.resolve({ kind: 'not_found' });
    }
    if (stored.status !== request.expectedStatus) {
      return Promise.resolve({ kind: 'status_changed', currentStatus: stored.status });
    }

    const revision = this.#revisions.get(request.userId) ?? aRevision(1);
    if (revision !== request.expectedRevision) {
      return Promise.resolve({ kind: 'revision_changed', currentRevision: revision });
    }

    const committed = request.advanceRevision ? nextRevision(revision) : revision;
    this.#proposals.set(key, request.proposal);
    this.#revisions.set(request.userId, committed);

    return Promise.resolve({ kind: 'committed', revision: committed });
  }
}

export class FixedClock implements Clock {
  #now: Date;

  constructor(now: Date) {
    this.#now = now;
  }

  set(now: Date): void {
    this.#now = now;
  }

  now(): Date {
    return this.#now;
  }
}

export interface TestPorts extends Ports {
  readonly proposals: InMemoryProposalStore;
  readonly clock: FixedClock;
}

export function createTestPorts(now = new Date('2026-09-16T12:00:00.000Z')): TestPorts {
  return {
    proposals: new InMemoryProposalStore(),
    clock: new FixedClock(now),
  };
}
