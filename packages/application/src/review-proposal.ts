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
 * The staleness comparison lives in the domain. This layer's job is to hand the
 * domain a revision read at DECISION time and then commit the result through a
 * single compare-and-set, so the check and the write cannot be separated by
 * another actor's commit.
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

  // Read the revision now, at decision time. Reading it earlier would reintroduce
  // exactly the race the stale rule exists to catch.
  const currentRevision = await ports.proposals.currentRevision(command.userId);
  const context = { currentRevision, decidedAt: ports.clock.now() };

  const decided =
    command.decision === 'accept'
      ? acceptProposal(proposal, context)
      : rejectProposal(proposal, context);

  if (!decided.ok) {
    if (decided.error.kind === 'stale_base_revision') {
      await ports.proposals.markStaleIfPending(command.userId, proposal.id);
    }
    return err(decided.error);
  }

  // Accepting applies the proposal, which changes the plan; rejecting does not.
  const advanceRevision = command.decision === 'accept';
  const outcome = await ports.proposals.commitDecision({
    userId: command.userId,
    proposal: decided.value,
    expectedRevision: currentRevision,
    expectedStatus: proposal.status,
    advanceRevision,
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
