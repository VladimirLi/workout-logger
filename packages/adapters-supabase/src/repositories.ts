import type {
  CommitDecisionOutcome,
  CommitDecisionRequest,
  MarkStaleOutcome,
  ProposalStore,
} from '@workout/application';
import type { Proposal, Revision } from '@workout/domain';
import type { ServerSupabaseConfig } from './config.js';

/**
 * Supabase adapter SKELETON.
 *
 * Deliberately unimplemented. No Supabase project, schema, or credential exists
 * (docs/external-gates.md, G-2), so an implementation here would be fiction that
 * had never touched a database.
 *
 * When G-2 closes, these methods are implemented and the existing contract suite
 * in @workout/test-support is run against them unchanged (ADR-0005).
 *
 * `commitDecision` MUST be a single statement or transaction that evaluates the
 * expected revision and status and performs the write together - for example one
 * `UPDATE ... WHERE status = $expected` against a plan row whose revision is
 * checked in the same transaction. Implementing it as a read followed by a write
 * will pass the round-trip cases in the contract suite and fail its compare-and-set
 * cases, which is the whole point of them.
 */

class NotProvisionedError extends Error {
  constructor(operation: string) {
    super(
      `Supabase adapter is not provisioned: ${operation}. ` +
        'See docs/external-gates.md, gate G-2. This adapter is a skeleton until a ' +
        'Supabase project exists and its contract suite passes.',
    );
    this.name = 'NotProvisionedError';
  }
}

export class SupabaseProposalStore implements ProposalStore {
  readonly #config: ServerSupabaseConfig;

  constructor(config: ServerSupabaseConfig) {
    this.#config = config;
  }

  get projectUrl(): string {
    return this.#config.url;
  }

  currentRevision(_userId: string): Promise<Revision> {
    return Promise.reject(new NotProvisionedError('ProposalStore.currentRevision'));
  }

  findById(_userId: string, _proposalId: string): Promise<Proposal | undefined> {
    return Promise.reject(new NotProvisionedError('ProposalStore.findById'));
  }

  commitDecision(_request: CommitDecisionRequest): Promise<CommitDecisionOutcome> {
    return Promise.reject(new NotProvisionedError('ProposalStore.commitDecision'));
  }

  /**
   * MUST be a single conditional update - `UPDATE proposals SET status = 'rejected_stale'
   * WHERE id = $1 AND user_id = $2 AND status = 'pending'` - and MUST NOT reference the
   * plan revision. Conditioning it on the revision is the bug it exists to fix.
   */
  markStaleIfPending(_userId: string, _proposalId: string): Promise<MarkStaleOutcome> {
    return Promise.reject(new NotProvisionedError('ProposalStore.markStaleIfPending'));
  }
}

export { NotProvisionedError };
