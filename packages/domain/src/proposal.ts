import type { PlanDiff } from './plan-diff.js';
import { err, ok, type Result } from './result.js';
import { type Revision, sameRevision } from './revision.js';

/**
 * Agent proposals (D-016, D-017, D-018, ADR-0002).
 *
 * An external agent never mutates authoritative data. It creates a proposal
 * against a base revision. If that base revision has moved by the time the user
 * decides, the proposal is rejected as stale and must be regenerated.
 *
 * The system does not rebase, does not merge, and does not ask the user to
 * adjudicate a three-way diff. Wasted agent work is preferred over a wrong merge.
 */

export const PROPOSAL_STATUSES = [
  'pending',
  'accepted',
  'rejected',
  'rejected_stale',
  'expired',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface ProposalActor {
  /** The authenticated MCP client authorization, never a bare token value. */
  readonly clientId: string;
  readonly actorId: string;
}

export interface Proposal {
  readonly id: string;
  readonly actor: ProposalActor;
  /** The authoritative revision the agent computed this diff against. */
  readonly baseRevision: Revision;
  /**
   * Canonical structured diff, restricted to the operations the first slice
   * supports. This module does not interpret it - it is evidence, not logic - but
   * it is no longer shapeless: an unconstrained diff is a proposal whose substance
   * was never validated before the user was asked to approve it.
   */
  readonly diff: PlanDiff;
  /** The agent's reasoning. Authoritative proposal data, never operational telemetry. */
  readonly rationale: string;
  readonly inputHash: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly status: ProposalStatus;
}

export type ProposalRejection =
  /**
   * The authoritative base revision changed after the proposal was created.
   * Regenerate the proposal against the current revision.
   */
  | {
      readonly kind: 'stale_base_revision';
      readonly baseRevision: Revision;
      readonly currentRevision: Revision;
    }
  | { readonly kind: 'expired'; readonly expiresAt: Date; readonly decidedAt: Date }
  | { readonly kind: 'already_decided'; readonly status: ProposalStatus };

export interface ReviewContext {
  /** The authoritative revision at the moment the user decides. */
  readonly currentRevision: Revision;
  readonly decidedAt: Date;
}

/**
 * Checks, in a fixed order, whether a pending proposal may still be acted on.
 *
 * Order matters and is deliberate:
 *   1. already decided  - a second decision on the same proposal is a caller bug
 *   2. expired          - a proposal past its lifetime is not reviewable at all
 *   3. stale base       - the substantive rule
 *
 * Staleness is checked last so that an expired proposal reports expiry rather
 * than incidentally reporting staleness.
 */
export function checkProposalReviewable(
  proposal: Proposal,
  context: ReviewContext,
): Result<Proposal, ProposalRejection> {
  if (proposal.status !== 'pending') {
    return err({ kind: 'already_decided', status: proposal.status });
  }
  if (context.decidedAt.getTime() >= proposal.expiresAt.getTime()) {
    return err({ kind: 'expired', expiresAt: proposal.expiresAt, decidedAt: context.decidedAt });
  }
  if (!sameRevision(proposal.baseRevision, context.currentRevision)) {
    return err({
      kind: 'stale_base_revision',
      baseRevision: proposal.baseRevision,
      currentRevision: context.currentRevision,
    });
  }
  return ok(proposal);
}

/**
 * Accepting a proposal is the only path by which agent-authored content becomes
 * authoritative, and it goes through the same staleness check as everything else.
 */
export function acceptProposal(
  proposal: Proposal,
  context: ReviewContext,
): Result<Proposal, ProposalRejection> {
  const reviewable = checkProposalReviewable(proposal, context);
  if (!reviewable.ok) {
    return reviewable;
  }
  return ok({ ...proposal, status: 'accepted' });
}

/**
 * A user may reject a proposal whose base revision has moved: rejecting it is a
 * decision about content, and refusing the rejection would strand the record as
 * permanently pending. Expiry and prior decisions still block.
 */
export function rejectProposal(
  proposal: Proposal,
  // Only the decision time. Rejection does not depend on the plan revision, and the
  // signature says so rather than accepting a revision it would ignore.
  context: Pick<ReviewContext, 'decidedAt'>,
): Result<Proposal, ProposalRejection> {
  if (proposal.status !== 'pending') {
    return err({ kind: 'already_decided', status: proposal.status });
  }
  if (context.decidedAt.getTime() >= proposal.expiresAt.getTime()) {
    return err({ kind: 'expired', expiresAt: proposal.expiresAt, decidedAt: context.decidedAt });
  }
  return ok({ ...proposal, status: 'rejected' });
}

/** Marks a proposal stale so the agent can observe it and regenerate. */
export function markStale(proposal: Proposal): Proposal {
  return { ...proposal, status: 'rejected_stale' };
}

export function isStaleRejection(
  rejection: ProposalRejection,
): rejection is Extract<ProposalRejection, { kind: 'stale_base_revision' }> {
  return rejection.kind === 'stale_base_revision';
}
