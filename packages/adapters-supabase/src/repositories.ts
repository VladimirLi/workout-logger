import type {
  CommitDecisionOutcome,
  CommitDecisionRequest,
  CreatePendingOutcome,
  CreatePendingRequest,
  MarkStaleOutcome,
  ProposalStore,
  RejectOutcome,
} from '@workout/application';
import { isoTimestamp, proposalStatusSchema, storedPlanDiffSchema } from '@workout/contracts';
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

/**
 * Reading a row is reading untrusted input (ADR-0012).
 *
 * A row arrives as JSON over HTTP, and casting it into the domain's types moves the failure to
 * wherever the value is finally used, with no clue where it came from: a status outside the
 * vocabulary has no rule anywhere to catch it, a revision that arrived as `"5"` compares equal to
 * nothing, and a diff whose operation nobody implements reaches the plan. So each field is
 * checked against the rule the domain actually has for it, and a row that fails is an error
 * naming the field rather than a value handed on.
 *
 * `inputHash` and the actor ids are checked as strings and no further. The MCP wire contract
 * requires a `sha256:` digest of an incoming proposal, but the domain's `Proposal` states no
 * format, so imposing one here would make a stored row unreadable over a rule the domain does
 * not have - a denial of read rather than a safety property.
 */

function fail(field: string, why: string): never {
  throw new Error(`a proposals row is unusable: ${field} ${why}`);
}

function aString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(field, 'is not a non-empty string');
  return value;
}

function anOptionalString(value: unknown, field: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') fail(field, 'is not a string or null');
  return value;
}

function aStoredRevision(value: unknown, field: string): Revision {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(field, 'is not a positive whole revision');
  }
  return value as Revision;
}

/**
 * An instant, validated before a `Date` is constructed from it.
 *
 * `new Date` is not a check: it accepts a bare date, a space-separated timestamp and `Sep 18
 * 2026`, and reads a time with no offset in whatever zone the process is in - so the same row
 * would give a proposal a different lifetime on a server in Stockholm and one in UTC. The rule is
 * the contract's (packages/contracts/src/primitives.ts), which is what every other boundary in
 * the product uses, and which the timestamps PostgREST returns satisfy.
 */
function aTime(value: unknown, field: string): Date {
  if (!isoTimestamp.safeParse(value).success) {
    fail(field, `is not an ISO-8601 instant with an offset: ${JSON.stringify(value)}`);
  }
  return new Date(value as string);
}

function aStatus(value: unknown, field: string): ProposalStatus {
  const parsed = proposalStatusSchema.safeParse(value);
  if (!parsed.success) fail(field, `is not a status the domain defines: ${String(value)}`);
  return parsed.data;
}

function aDiff(value: unknown, field: string): PlanDiff {
  // The same closed union the wire contract enforces, so the substance of a proposal is
  // validated rather than trusted (packages/contracts/src/plan-diff.ts).
  const parsed = storedPlanDiffSchema.safeParse(value);
  if (!parsed.success) fail(field, 'is not a plan diff this version understands');
  return parsed.data as PlanDiff;
}

function toProposal(row: unknown): Proposal {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new Error('a proposals row is unusable: it is not an object');
  }
  const record = row as Record<string, unknown>;
  const createdAt = aTime(record['created_at'], 'created_at');
  return {
    id: aString(record['id'], 'id'),
    actor: {
      clientId: anOptionalString(record['actor_client_id'], 'actor_client_id'),
      actorId: anOptionalString(record['actor_agent_id'], 'actor_agent_id'),
    },
    baseRevision: aStoredRevision(record['base_revision'], 'base_revision'),
    diff: aDiff(record['diff'], 'diff'),
    rationale: aString(record['rationale'], 'rationale'),
    inputHash: anOptionalString(record['input_hash'], 'input_hash'),
    createdAt,
    expiresAt:
      record['expires_at'] === null || record['expires_at'] === undefined
        ? createdAt
        : aTime(record['expires_at'], 'expires_at'),
    status: aStatus(record['status'], 'status'),
    ...(record['decided_at'] === null || record['decided_at'] === undefined
      ? {}
      : { decidedAt: aTime(record['decided_at'], 'decided_at') }),
  };
}

/** PostgREST answers a filtered select with a list. Anything else is not a result set. */
function rowsOf(body: unknown): readonly unknown[] {
  if (!Array.isArray(body)) {
    throw new Error('the database did not answer with a list of rows');
  }
  return body;
}

/**
 * What `accept_proposal` and `reject_proposal` return.
 *
 * Validated at runtime, never asserted: a response is untrusted input like any other. A revision
 * must be a positive whole number, as `Revision` requires, and a status must be one the domain
 * defines - otherwise a server this version does not understand would feed the domain a value it
 * has no rule for.
 */
type DecisionOutcome =
  | { kind: 'committed'; revision?: Revision }
  | { kind: 'revision_changed'; currentRevision: Revision }
  | { kind: 'status_changed'; currentStatus: ProposalStatus }
  | { kind: 'expired' }
  | { kind: 'not_found' };

function reportedRevision(value: unknown): Revision | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
    ? (value as Revision)
    : undefined;
}

function reportedStatus(value: unknown): ProposalStatus | undefined {
  const parsed = proposalStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function decisionOf(body: unknown): DecisionOutcome | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as Record<string, unknown>;
  switch (record['kind']) {
    case 'committed': {
      // Absent for a rejection, which never reads the plan. Present and invalid is not the same
      // thing as absent, so a bad value is still refused.
      if (record['revision'] === undefined) return { kind: 'committed' };
      const revision = reportedRevision(record['revision']);
      return revision === undefined ? undefined : { kind: 'committed', revision };
    }
    case 'revision_changed': {
      const currentRevision = reportedRevision(record['currentRevision']);
      return currentRevision === undefined
        ? undefined
        : { kind: 'revision_changed', currentRevision };
    }
    case 'status_changed': {
      const currentStatus = reportedStatus(record['currentStatus']);
      return currentStatus === undefined ? undefined : { kind: 'status_changed', currentStatus };
    }
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
    this.#rest = { url: config.url, key: config.publishableKey, accessToken: user.accessToken };
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
    const rows = rowsOf(
      await select<unknown>(
        this.#rest,
        'plans',
        `user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=revision`,
      ),
    );
    const first = rows[0];
    if (first === undefined) {
      throw new Error(`no active plan for user ${userId}`);
    }
    if (typeof first !== 'object' || first === null) {
      throw new Error('the active plan row is unusable: it is not an object');
    }
    const revision = (first as Record<string, unknown>)['revision'];
    if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) {
      throw new Error(
        `the active plan's revision is not a positive whole number: ${String(revision)}`,
      );
    }
    return revision as Revision;
  }

  async findById(userId: string, proposalId: string): Promise<Proposal | undefined> {
    const rows = rowsOf(
      await select<unknown>(
        this.#rest,
        'proposals',
        `user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(proposalId)}&select=*`,
      ),
    );
    const row = rows[0];
    return row === undefined ? undefined : toProposal(row);
  }

  async listPending(userId: string): Promise<readonly Proposal[]> {
    if (!this.#actsFor(userId)) return [];
    const rows = rowsOf(
      await select<unknown>(
        this.#rest,
        'proposals',
        `user_id=eq.${encodeURIComponent(userId)}&status=eq.pending&select=*&order=created_at.desc`,
      ),
    );
    return rows.map((row) => toProposal(row));
  }

  /**
   * The decision, and the expectations it was made against (ADR-0012, I-5 and I-6).
   *
   * The port's compare-and-set is carried to the server rather than dropped here: the caller
   * says which status and which revision it decided against, and the server compares both with
   * rows it locks. This is not trust - an expectation can only lose, and the answer is always
   * the value the server holds. What the caller may NOT say is the target status, the decision
   * time, or whether the plan advances; those follow from the decision itself.
   *
   * Accepting and rejecting are separate functions because a rejection must not read the plan at
   * all, which is a property of the code path rather than of a flag.
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

    // An acceptance changes the plan and a rejection does not, so a request that says otherwise
    // contradicts itself. Committing either meaning would be guessing which half is the bug.
    if (request.advanceRevision !== (decision === 'accept')) {
      throw new Error(
        `a request to ${decision} a proposal must ` +
          `${decision === 'accept' ? 'advance' : 'not advance'} the revision`,
      );
    }

    const outcome = decisionOf(
      decision === 'accept'
        ? await rpc<unknown>(this.#rest, 'accept_proposal', {
            p_proposal_id: request.proposal.id,
            p_expected_status: request.expectedStatus,
            p_expected_revision: request.expectedRevision,
          })
        : await rpc<unknown>(this.#rest, 'reject_proposal', {
            p_proposal_id: request.proposal.id,
            p_expected_status: request.expectedStatus,
          }),
    );

    switch (outcome?.kind) {
      case 'committed':
        return outcome.revision === undefined
          ? { kind: 'committed' }
          : { kind: 'committed', revision: outcome.revision };
      case 'revision_changed':
        return { kind: 'revision_changed', currentRevision: outcome.currentRevision };
      case 'status_changed':
        return { kind: 'status_changed', currentStatus: outcome.currentStatus };
      case 'expired':
        // Terminal, and not a status the port names for a commit. Reported as what it is.
        return { kind: 'status_changed', currentStatus: 'expired' };
      case 'not_found':
        return { kind: 'not_found' };
      default:
        throw new Error('the decision returned a body this version does not understand');
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
      await rpc<unknown>(this.#rest, 'reject_proposal', {
        p_proposal_id: proposalId,
        // Only a pending proposal is rejectable, which is the expectation this call makes.
        p_expected_status: 'pending',
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
        throw new Error('the rejection returned a body this version does not understand');
    }
  }

  createPending(_request: CreatePendingRequest): Promise<CreatePendingOutcome> {
    return Promise.reject(
      new Error('createPending requires create_proposal; not deployed on this store yet'),
    );
  }
}
