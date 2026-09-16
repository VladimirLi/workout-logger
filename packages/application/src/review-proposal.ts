import {
  acceptProposal,
  err,
  ok,
  type Proposal,
  type ProposalRejection,
  type Result,
  rejectProposal,
} from '@workout/domain';
import type { Ports } from './ports.js';

/**
 * Use case: the user decides on an agent proposal (ADR-0002).
 *
 * Accepting and rejecting are deliberately different operations.
 *
 * ACCEPTING applies agent-authored content to the plan, so it depends on the plan
 * revision: the domain compares the base revision read at DECISION time, and the
 * result commits through a compare-and-set over both revision and status, so another
 * actor's commit cannot slip between the check and the write.
 *
 * REJECTING changes nothing in the plan. It is a status-only compare-and-set that never
 * reads the revision, so a plan change landing mid-rejection cannot turn the user's
 * decision into a different one.
 */

export type ReviewDecision = 'accept' | 'reject';

export type ReviewProposalFailure =
  | { readonly kind: 'not_found'; readonly proposalId: string }
  | ProposalRejection;

export interface ReviewProposalCommand {
  readonly userId: string;
  readonly proposalId: string;
  readonly decision: ReviewDecision;
}

export async function reviewProposal(
  ports: Ports,
  command: ReviewProposalCommand,
): Promise<Result<Proposal, ReviewProposalFailure>> {
  const proposal = await ports.proposals.findById(command.userId, command.proposalId);
  if (!proposal) {
    return err({ kind: 'not_found', proposalId: command.proposalId });
  }

  if (command.decision === 'reject') {
    return rejectPending(ports, command, proposal);
  }

  // Read the revision now, at decision time. Reading it earlier would reintroduce
  // exactly the race the stale rule exists to catch.
  const currentRevision = await ports.proposals.currentRevision(command.userId);
  const context = { currentRevision, decidedAt: ports.clock.now() };

  const decided = acceptProposal(proposal, context);

  if (!decided.ok) {
    if (decided.error.kind === 'stale_base_revision') {
      await ports.proposals.markStaleIfPending(command.userId, proposal.id);
    }
    return err(decided.error);
  }

  // Accepting applies the proposal, so the commit also advances the plan revision.
  const outcome = await ports.proposals.commitDecision({
    userId: command.userId,
    proposal: decided.value,
    expectedRevision: currentRevision,
    expectedStatus: proposal.status,
    advanceRevision: true,
  });

  switch (outcome.kind) {
    case 'committed':
      return ok(decided.value);

    case 'revision_changed':
      // The plan moved inside the commit window. The domain rule was evaluated
      // against a revision that is no longer authoritative, so the decision is void.
      await ports.proposals.markStaleIfPending(command.userId, proposal.id);
      return err({
        kind: 'stale_base_revision',
        baseRevision: proposal.baseRevision,
        currentRevision: outcome.currentRevision,
      });

    case 'status_changed':
      return err({ kind: 'already_decided', status: outcome.currentStatus });

    case 'not_found':
      return err({ kind: 'not_found', proposalId: command.proposalId });
  }
}

/**
 * Rejection: a status-only transition, independent of the plan revision.
 *
 * The domain still decides whether the proposal may be rejected at all - an expired
 * or already-decided proposal may not - and the store then moves it from pending to
 * rejected in one atomic step, or reports that someone else decided it first.
 */
async function rejectPending(
  ports: Ports,
  command: ReviewProposalCommand,
  proposal: Proposal,
): Promise<Result<Proposal, ReviewProposalFailure>> {
  const allowed = rejectProposal(proposal, { decidedAt: ports.clock.now() });
  if (!allowed.ok) {
    return err(allowed.error);
  }

  const outcome = await ports.proposals.rejectIfPending(command.userId, proposal.id);
  switch (outcome.kind) {
    case 'rejected':
      return ok(outcome.proposal);
    case 'not_pending':
      return err({ kind: 'already_decided', status: outcome.status });
    case 'not_found':
      return err({ kind: 'not_found', proposalId: command.proposalId });
  }
}
