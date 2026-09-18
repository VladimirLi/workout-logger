import type {
  CommitDecisionOutcome,
  CommitDecisionRequest,
  MarkStaleOutcome,
  ProposalStore,
  RejectOutcome,
} from '@workout/application';
import type { PlanDiff, Proposal, ProposalStatus, Revision } from '@workout/domain';
import type { ServerSupabaseConfig } from './config.js';
import { type RestConfig, rpc, select } from './rest.js';

/**
 * The Supabase implementation of the proposal store (ADR-0005, task 2.5).
 *
 * Every compare-and-set goes through a database function, because it cannot be expressed as a
 * read followed by a write from here: the plan revision and the proposal status have to be
 * evaluated and written in one transaction, or two proposals can be accepted onto the same
 * base (D-018). The functions are in supabase/migrations; this class only calls them and
 * translates the outcome.
 *
 * It filters by `user_id` explicitly even though row-level security also filters, so a client
 * that bypasses row-level security - the server's own service role - still cannot reach
 * another user's rows by omission.
 *
 * The same contract suite the in-memory reference runs is run against this
 * (packages/adapters-supabase/src/proposal-store.contract.test.ts), against a real database.
 */

interface ProposalRow {
  id: string;
  base_revision: number;
  diff: PlanDiff;
  rationale: string;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
  actor_client_id: string | null;
  actor_agent_id: string | null;
  input_hash: string | null;
  expires_at: string | null;
}

function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    actor: { clientId: row.actor_client_id ?? '', actorId: row.actor_agent_id ?? '' },
    baseRevision: row.base_revision as Revision,
    diff: row.diff,
    rationale: row.rationale,
    inputHash: row.input_hash ?? '',
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at ?? row.created_at),
    status: row.status,
  };
}

export class SupabaseProposalStore implements ProposalStore {
  readonly #rest: RestConfig;

  constructor(config: ServerSupabaseConfig, accessToken?: string) {
    this.#rest = {
      url: config.url,
      key: config.serviceRoleKey,
      ...(accessToken ? { accessToken } : {}),
    };
  }

  get projectUrl(): string {
    return this.#rest.url;
  }

  async currentRevision(userId: string): Promise<Revision> {
    const rows = await select<{ revision: number }>(
      this.#rest,
      'plans',
      `user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=revision`,
    );
    const revision = rows[0]?.revision;
    if (revision === undefined) {
      throw new Error(`no active plan for user ${userId}`);
    }
    return revision as Revision;
  }

  async findById(userId: string, proposalId: string): Promise<Proposal | undefined> {
    const rows = await select<ProposalRow>(
      this.#rest,
      'proposals',
      `user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(proposalId)}&select=*`,
    );
    const row = rows[0];
    return row ? toProposal(row) : undefined;
  }

  async commitDecision(request: CommitDecisionRequest): Promise<CommitDecisionOutcome> {
    const outcome = await rpc<{
      kind: 'committed' | 'revision_changed' | 'status_changed' | 'not_found';
      revision?: number;
      currentRevision?: number;
      currentStatus?: ProposalStatus;
    }>(this.#rest, 'commit_proposal_decision', {
      p_user_id: request.userId,
      p_proposal_id: request.proposal.id,
      p_status: request.proposal.status,
      p_expected_revision: request.expectedRevision,
      p_expected_status: request.expectedStatus,
      p_decided_at: new Date().toISOString(),
      p_advance_revision: request.advanceRevision,
    });

    switch (outcome.kind) {
      case 'committed':
        return { kind: 'committed', revision: (outcome.revision ?? 0) as Revision };
      case 'revision_changed':
        return {
          kind: 'revision_changed',
          currentRevision: (outcome.currentRevision ?? 0) as Revision,
        };
      case 'status_changed':
        return { kind: 'status_changed', currentStatus: outcome.currentStatus ?? 'pending' };
      case 'not_found':
        return { kind: 'not_found' };
    }
  }

  async markStaleIfPending(userId: string, proposalId: string): Promise<MarkStaleOutcome> {
    return rpc<MarkStaleOutcome>(this.#rest, 'mark_proposal_stale_if_pending', {
      p_user_id: userId,
      p_proposal_id: proposalId,
      p_decided_at: new Date().toISOString(),
    });
  }

  async rejectIfPending(userId: string, proposalId: string): Promise<RejectOutcome> {
    const outcome = await rpc<{
      kind: 'rejected' | 'not_pending' | 'not_found';
      status?: ProposalStatus;
    }>(this.#rest, 'reject_proposal_if_pending', {
      p_user_id: userId,
      p_proposal_id: proposalId,
      p_decided_at: new Date().toISOString(),
    });

    switch (outcome.kind) {
      case 'rejected': {
        const proposal = await this.findById(userId, proposalId);
        if (!proposal) return { kind: 'not_found' };
        return { kind: 'rejected', proposal };
      }
      case 'not_pending':
        return { kind: 'not_pending', status: outcome.status ?? 'pending' };
      case 'not_found':
        return { kind: 'not_found' };
    }
  }
}
