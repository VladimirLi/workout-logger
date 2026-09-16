import type { Proposal, ProposalStatus, Revision } from '@workout/domain';

/**
 * Provider-neutral ports (ADR-0001, ADR-0005).
 *
 * These are the only way the application layer reaches the outside world. No
 * Supabase type, no HTTP type, no Next.js type appears here. An adapter package
 * implements them; the architecture gate forbids this layer from importing one.
 */

/** Wall-clock time as a dependency, so every time-sensitive rule is testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface CommitDecisionRequest {
  readonly userId: string;
  /** The decided proposal, exactly as it should be persisted. */
  readonly proposal: Proposal;
  /** The revision the decision was computed against. */
  readonly expectedRevision: Revision;
  /** The proposal status the decision was computed against. */
  readonly expectedStatus: ProposalStatus;
  /**
   * True when the decision changes the plan, so the commit must also advance the
   * authoritative revision in the same transaction.
   */
  readonly advanceRevision: boolean;
}

export type CommitDecisionOutcome =
  | { readonly kind: 'committed'; readonly revision: Revision }
  /** The plan moved between the read and the commit. The decision is void. */
  | { readonly kind: 'revision_changed'; readonly currentRevision: Revision }
  /** Someone else decided this proposal first. */
  | { readonly kind: 'status_changed'; readonly currentStatus: ProposalStatus }
  | { readonly kind: 'not_found' };

/**
 * The proposal store.
 *
 * Reads and the decision commit live on ONE port deliberately. Splitting the plan
 * revision and the proposal record across two ports made atomicity inexpressible:
 * the use case had to read the revision, decide, and save as three separate
 * operations, leaving a window in which another actor could advance the plan and
 * two proposals could both be accepted onto the same base (D-018).
 *
 * `commitDecision` is a compare-and-set. An implementation MUST evaluate the
 * expected revision and the expected status, persist the proposal, and advance the
 * revision, in a single atomic step. An implementation that performs these as
 * separate statements does not satisfy this contract, however carefully it is
 * written.
 */
/**
 * Outcome of the status-only stale transition.
 *
 * `not_pending` covers both "already stale" and "already decided", because from the
 * caller's point of view they are the same: the proposal is no longer reviewable and
 * nothing needs doing.
 */
export type MarkStaleOutcome = 'marked' | 'not_pending' | 'not_found';

export interface ProposalStore {
  /** The current authoritative revision of the active plan. */
  currentRevision(userId: string): Promise<Revision>;

  findById(userId: string, proposalId: string): Promise<Proposal | undefined>;

  commitDecision(request: CommitDecisionRequest): Promise<CommitDecisionOutcome>;

  /**
   * Atomically moves a PENDING proposal to the terminal stale status, and does
   * nothing otherwise.
   *
   * Deliberately status-only: it MUST NOT compare, read, or advance the plan
   * revision. Recording staleness through the revision compare-and-set was itself
   * refused when the plan moved a second time between detecting staleness and
   * recording it, leaving the proposal `pending` - still offered for review, still
   * carrying a base revision that can never match again.
   *
   * "This proposal is stale" is correct regardless of what the revision does next,
   * so conditioning the write on the revision was the bug.
   *
   * Idempotent, and never overwrites a decision already made.
   */
  markStaleIfPending(userId: string, proposalId: string): Promise<MarkStaleOutcome>;
}

export interface Ports {
  readonly proposals: ProposalStore;
  readonly clock: Clock;
}
