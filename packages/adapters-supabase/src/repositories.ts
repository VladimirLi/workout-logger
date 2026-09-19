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
 * It acts as one signed-in user. The port names a user on every call because an in-memory
 * store can hold many; this one cannot act for anybody but the user whose token it holds, so a
 * call naming another user is answered the way the database answers it - the row is not there.
 * It filters by `user_id` explicitly as well, so a mistake here cannot reach another user's
 * rows even from a client that bypasses row-level security.
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

/** What `decide_proposal` returns. Checked at runtime, never asserted (review warning). */
type DecisionOutcome =
  | { kind: 'committed'; revision: number }
  | { kind: 'revision_changed'; currentRevision: number }
  | { kind: 'status_changed'; currentStatus: ProposalStatus }
  | { kind: 'expired' }
  | { kind: 'not_found' };

function decisionOf(body: unknown): DecisionOutcome | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  switch (record['kind']) {
    case 'committed':
      return typeof record['revision'] === 'number'
        ? { kind: 'committed', revision: record['revision'] }
        : undefined;
    case 'revision_changed':
      return typeof record['currentRevision'] === 'number'
        ? { kind: 'revision_changed', currentRevision: record['currentRevision'] }
        : undefined;
    case 'status_changed':
      return typeof record['currentStatus'] === 'string'
        ? { kind: 'status_changed', currentStatus: record['currentStatus'] as ProposalStatus }
        : undefined;
    case 'expired':
      return { kind: 'expired' };
    case 'not_found':
      return { kind: 'not_found' };
    default:
      return undefined;
  }
}

/** The user a store acts as: an id to answer the port with, and the token that proves it. */
export interface SignedInUser {
  readonly id: string;
  readonly accessToken: string;
}

export class SupabaseProposalStore implements ProposalStore {
  readonly #rest: RestConfig;
  readonly #userId: string;

  /**
   * @param user the signed-in user. Every decision is taken by the server from the identity in
   * the token, so the adapter cannot decide on anyone else's behalf; the id is here only to
   * answer the port truthfully when a call names somebody else.
   */
  constructor(config: ServerSupabaseConfig, user: SignedInUser) {
    this.#rest = { url: config.url, key: config.anonKey, accessToken: user.accessToken };
    this.#userId = user.id;
  }

  /**
   * Whether this store can act for the named user at all.
   *
   * The write functions take their identity from the token, so asking one to act for another
   * user is not expressible. Refusing here keeps that honest: without it a call naming someone
   * else would silently be carried out against this user's own rows.
   */
  #actsFor(userId: string): boolean {
    return userId === this.#userId;
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

  /**
   * The decision, not its consequences.
   *
   * The port carries the expected revision and status because an in-memory store needs them.
   * The server does not: it reads the proposal's own base revision and the plan's, both under
   * lock, and stamps the time itself. Sending them would be offering a caller the chance to
   * be wrong about its own decision.
   */
  async commitDecision(request: CommitDecisionRequest): Promise<CommitDecisionOutcome> {
    if (!this.#actsFor(request.userId)) return { kind: 'not_found' };
    const decision =
      request.proposal.status === 'accepted'
        ? 'accept'
        : request.proposal.status === 'rejected'
          ? 'reject'
          : undefined;
    if (!decision) {
      // Only the two transitions a user can make are expressible. Rather than echo the
      // caller's expectation back, report what is actually there: a proposal that is not
      // stored cannot have been left in any status.
      const stored = await this.findById(request.userId, request.proposal.id);
      return stored
        ? { kind: 'status_changed', currentStatus: stored.status }
        : { kind: 'not_found' };
    }

    const outcome = decisionOf(
      await rpc<unknown>(this.#rest, 'decide_proposal', {
        p_proposal_id: request.proposal.id,
        p_decision: decision,
      }),
    );

    switch (outcome?.kind) {
      case 'committed':
        return { kind: 'committed', revision: outcome.revision as Revision };
      case 'revision_changed':
        return { kind: 'revision_changed', currentRevision: outcome.currentRevision as Revision };
      case 'status_changed':
        return { kind: 'status_changed', currentStatus: outcome.currentStatus };
      case 'expired':
        // Terminal, and not a status the port names for a commit. Reported as what it is.
        return { kind: 'status_changed', currentStatus: 'expired' };
      case 'not_found':
        return { kind: 'not_found' };
      default:
        throw new Error('decide_proposal returned a body this version does not understand');
    }
  }

  async markStaleIfPending(userId: string, proposalId: string): Promise<MarkStaleOutcome> {
    if (!this.#actsFor(userId)) return 'not_found';
    const outcome = await rpc<unknown>(this.#rest, 'mark_proposal_stale_if_pending', {
      p_proposal_id: proposalId,
    });
    if (outcome === 'marked' || outcome === 'not_pending' || outcome === 'not_found') {
      return outcome;
    }
    throw new Error('mark_proposal_stale_if_pending returned an unrecognised outcome');
  }

  async rejectIfPending(userId: string, proposalId: string): Promise<RejectOutcome> {
    if (!this.#actsFor(userId)) return { kind: 'not_found' };
    const outcome = decisionOf(
      await rpc<unknown>(this.#rest, 'decide_proposal', {
        p_proposal_id: proposalId,
        p_decision: 'reject',
      }),
    );

    switch (outcome?.kind) {
      case 'committed': {
        const proposal = await this.findById(userId, proposalId);
        if (!proposal) return { kind: 'not_found' };
        return { kind: 'rejected', proposal };
      }
      case 'status_changed':
        return { kind: 'not_pending', status: outcome.currentStatus };
      case 'expired':
        return { kind: 'not_pending', status: 'expired' };
      case 'revision_changed':
        // A rejection never reads the revision, so this cannot happen; if it ever does, it is
        // a server this version does not understand rather than a silent wrong answer.
        throw new Error('a rejection reported a revision change');
      case 'not_found':
        return { kind: 'not_found' };
      default:
        throw new Error('decide_proposal returned a body this version does not understand');
    }
  }
}
