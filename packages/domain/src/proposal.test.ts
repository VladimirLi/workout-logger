import { describe, expect, it } from 'vitest';
import {
  acceptProposal,
  checkProposalReviewable,
  isStaleRejection,
  markStale,
  type Proposal,
  type ReviewContext,
  rejectProposal,
} from './proposal.js';
import { unwrap } from './result.js';
import { nextRevision, revision } from './revision.js';

const BASE = unwrap(revision(7));
const CREATED_AT = new Date('2026-09-16T10:00:00.000Z');
const EXPIRES_AT = new Date('2026-09-16T11:00:00.000Z');
const DECIDED_AT = new Date('2026-09-16T10:30:00.000Z');

function pendingProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: 'prop_01',
    actor: { clientId: 'client_abc', actorId: 'agent_planner' },
    baseRevision: BASE,
    diff: { op: 'replace_plan', sessions: [] },
    rationale: 'Deload week after three hard weeks.',
    inputHash: 'sha256:deadbeef',
    createdAt: CREATED_AT,
    expiresAt: EXPIRES_AT,
    status: 'pending',
    ...overrides,
  };
}

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return { currentRevision: BASE, decidedAt: DECIDED_AT, ...overrides };
}

describe('stale-revision rejection', () => {
  it('rejects a proposal whose base revision has moved forward', () => {
    const result = checkProposalReviewable(
      pendingProposal(),
      context({ currentRevision: nextRevision(BASE) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'stale_base_revision',
      baseRevision: 7,
      currentRevision: 8,
    });
  });

  it('rejects a proposal whose base revision differs in any direction, not only forward', () => {
    const laterBase = unwrap(revision(9));
    const result = checkProposalReviewable(
      pendingProposal({ baseRevision: laterBase }),
      context({ currentRevision: BASE }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(isStaleRejection(result.error)).toBe(true);
  });

  it('accepts a proposal whose base revision still matches', () => {
    const result = checkProposalReviewable(pendingProposal(), context());
    expect(result.ok).toBe(true);
  });

  it('never rebases: acceptance on a moved revision produces no accepted proposal', () => {
    const result = acceptProposal(
      pendingProposal(),
      context({ currentRevision: nextRevision(BASE) }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('stale_base_revision');
  });

  it('reports the current revision so the agent can regenerate against it', () => {
    const current = unwrap(revision(42));
    const result = acceptProposal(pendingProposal(), context({ currentRevision: current }));

    expect(result.ok).toBe(false);
    if (result.ok || !isStaleRejection(result.error)) {
      throw new Error('expected a stale rejection');
    }
    expect(result.error.currentRevision).toBe(42);
  });

  it('marks a stale proposal with a terminal status so it is not re-reviewed', () => {
    const stale = markStale(pendingProposal());
    expect(stale.status).toBe('rejected_stale');

    const result = checkProposalReviewable(stale, context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'already_decided', status: 'rejected_stale' });
  });
});

describe('acceptProposal', () => {
  it('accepts a fresh, unexpired, pending proposal', () => {
    const result = acceptProposal(pendingProposal(), context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('accepted');
  });

  it('preserves the evidence fields when accepting', () => {
    const proposal = pendingProposal();
    const result = acceptProposal(proposal, context());
    if (!result.ok) throw new Error('expected acceptance');

    expect(result.value.baseRevision).toBe(proposal.baseRevision);
    expect(result.value.diff).toBe(proposal.diff);
    expect(result.value.rationale).toBe(proposal.rationale);
    expect(result.value.inputHash).toBe(proposal.inputHash);
    expect(result.value.actor).toEqual(proposal.actor);
  });

  it('does not mutate the input proposal', () => {
    const proposal = pendingProposal();
    acceptProposal(proposal, context());
    expect(proposal.status).toBe('pending');
  });

  it('refuses a proposal that was already accepted', () => {
    const result = acceptProposal(pendingProposal({ status: 'accepted' }), context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'already_decided', status: 'accepted' });
  });
});

describe('expiry', () => {
  it('refuses a proposal decided exactly at its expiry instant', () => {
    const result = checkProposalReviewable(pendingProposal(), context({ decidedAt: EXPIRES_AT }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('expired');
  });

  it('reports expiry rather than staleness when both apply', () => {
    const result = checkProposalReviewable(
      pendingProposal(),
      context({
        decidedAt: new Date('2026-09-16T12:00:00.000Z'),
        currentRevision: nextRevision(BASE),
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('expired');
  });
});

describe('rejectProposal', () => {
  it('lets the user reject a proposal even when its base revision has moved', () => {
    const result = rejectProposal(
      pendingProposal(),
      context({ currentRevision: nextRevision(BASE) }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('rejected');
  });

  it('refuses to reject an expired proposal', () => {
    const result = rejectProposal(pendingProposal(), context({ decidedAt: EXPIRES_AT }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('expired');
  });

  it('refuses to reject an already-decided proposal', () => {
    const result = rejectProposal(pendingProposal({ status: 'rejected' }), context());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'already_decided', status: 'rejected' });
  });
});
