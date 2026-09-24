import { planDiffSchema } from '@workout/contracts';
import {
  err,
  ok,
  type PlanDiff,
  type Proposal,
  type ProposalActor,
  type Result,
  type Revision,
  revision,
} from '@workout/domain';
import type { Ports } from './ports.js';

export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export type CreateProposalFailure =
  | { readonly kind: 'invalid_rationale' }
  | { readonly kind: 'invalid_diff'; readonly message: string }
  | { readonly kind: 'invalid_base_revision' }
  | {
      readonly kind: 'stale_base_revision';
      readonly baseRevision: Revision;
      readonly currentRevision: Revision;
    };

export interface CreateProposalCommand {
  readonly userId: string;
  readonly actor: ProposalActor;
  readonly baseRevision: number;
  readonly rationale: string;
  readonly diff: unknown;
  readonly id: string;
  readonly inputHash: string;
}

export async function createProposal(
  ports: Ports,
  command: CreateProposalCommand,
): Promise<Result<Proposal, CreateProposalFailure>> {
  const rationale = command.rationale.trim();
  if (rationale.length === 0) {
    return err({ kind: 'invalid_rationale' });
  }

  const base = revision(command.baseRevision);
  if (!base.ok) {
    return err({ kind: 'invalid_base_revision' });
  }

  const parsed = planDiffSchema.safeParse(command.diff);
  if (!parsed.success) {
    return err({
      kind: 'invalid_diff',
      message: parsed.error.issues[0]?.message ?? 'invalid diff',
    });
  }
  const diff = parsed.data as PlanDiff;

  if (!/^sha256:[0-9a-f]{64}$/.test(command.inputHash)) {
    return err({ kind: 'invalid_diff', message: 'inputHash must be sha256:<64 hex>' });
  }
  if (command.id.trim().length === 0) {
    return err({ kind: 'invalid_diff', message: 'id is required' });
  }

  const now = ports.clock.now();
  const proposal: Proposal = {
    id: command.id,
    actor: command.actor,
    baseRevision: base.value,
    diff,
    rationale,
    inputHash: command.inputHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    status: 'pending',
  };

  const outcome = await ports.proposals.createPending({
    userId: command.userId,
    proposal,
  });

  if (outcome.kind === 'stale_base_revision') {
    return err({
      kind: 'stale_base_revision',
      baseRevision: outcome.baseRevision,
      currentRevision: outcome.currentRevision,
    });
  }

  return ok(outcome.proposal);
}
