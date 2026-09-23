import {
  type ActivePlan,
  type ApplyPlanDiffError,
  applyPlanDiff,
  err,
  type Plan,
  type Proposal,
  type Result,
} from '@workout/domain';
import type { PlanReader } from './offline-ports.js';
import type { Ports } from './ports.js';
import {
  type ReviewDecision,
  type ReviewProposalCommand,
  type ReviewProposalFailure,
  reviewProposal,
} from './review-proposal.js';

/**
 * Accept applies the proposal to the active plan, then commits the decision.
 *
 * Apply runs before the proposal status changes: a diff that cannot become plan state
 * (or a missing active plan) must not leave an accepted proposal or an advanced revision.
 * Reject stays a status-only path through `reviewProposal`.
 */

export type PlanApplier = PlanReader & {
  save(userId: string, plan: ActivePlan | Plan): Promise<void>;
};

export type ReviewAndApplyFailure =
  | ReviewProposalFailure
  | ApplyPlanDiffError
  | { readonly kind: 'no_active_plan' };

export interface ReviewAndApplyPorts extends Ports {
  readonly plans: PlanApplier;
}

export async function reviewAndApplyProposal(
  ports: ReviewAndApplyPorts,
  command: ReviewProposalCommand,
): Promise<Result<Proposal, ReviewAndApplyFailure>> {
  if (command.decision === 'reject') {
    return reviewProposal(ports, command);
  }

  const proposal = await ports.proposals.findById(command.userId, command.proposalId);
  if (!proposal) {
    return err({ kind: 'not_found', proposalId: command.proposalId });
  }

  const plan = await ports.plans.activePlan(command.userId);
  if (!plan || plan.status !== 'active') {
    return err({ kind: 'no_active_plan' });
  }

  const applied = applyPlanDiff(plan, proposal.diff);
  if (!applied.ok) return applied;

  const decided = await reviewProposal(ports, command);
  if (!decided.ok) return decided;

  const revision = await ports.proposals.currentRevision(command.userId);
  await ports.plans.save(command.userId, { ...applied.value, revision });
  return decided;
}

export type { ReviewDecision };
