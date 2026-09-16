import { reviewProposal } from '@workout/application';
import { describe, expect, it } from 'vitest';
import { aProposal, aRevision, SYNTHETIC_USER_ID } from './builders.js';
import { createTestPorts } from './in-memory-ports.js';

/**
 * Regression coverage for a non-atomic compare-and-decide.
 *
 * The use case used to read the authoritative revision, run the staleness rule, and
 * then save - three separate awaits. Between the read and the save, another actor
 * could advance the plan. Two proposals computed against revision 5 could both read
 * 5, both pass the check, and both be accepted onto the same base. That is exactly
 * the outcome D-018 exists to prevent, and no amount of care in the domain rule can
 * close it, because the window is in the orchestration.
 *
 * The decision now commits through a single compare-and-set on the port. These tests
 * are deterministic: concurrency is simulated by a hook that fires inside the commit
 * window, not by real timing.
 */

describe('compare-and-decide is atomic', () => {
  it('rejects the decision when the plan advances inside the commit window', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    // Another actor commits between the revision read and this decision's commit.
    ports.proposals.onBeforeCommit(() => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    });

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'stale_base_revision',
      baseRevision: 5,
      currentRevision: 6,
    });
  });

  it('does not advance the plan when the commit is refused', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);
    ports.proposals.onBeforeCommit(() => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    });

    await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
  });

  it('advances the plan revision exactly once on a successful acceptance', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(true);
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
  });

  it('accepts only one of two proposals racing on the same base revision', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    const first = aProposal({ id: 'prop_a', baseRevision: aRevision(5) });
    const second = aProposal({ id: 'prop_b', baseRevision: aRevision(5) });
    ports.proposals.seed(SYNTHETIC_USER_ID, first);
    ports.proposals.seed(SYNTHETIC_USER_ID, second);

    const results = await Promise.all([
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: 'prop_a',
        decision: 'accept',
      }),
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: 'prop_b',
        decision: 'accept',
      }),
    ]);

    const accepted = results.filter((result) => result.ok);
    const stale = results.filter(
      (result) => !result.ok && result.error.kind === 'stale_base_revision',
    );

    expect(accepted).toHaveLength(1);
    expect(stale).toHaveLength(1);
    // Exactly one application of one proposal.
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
  });

  it('marks the losing proposal stale so the agent can regenerate', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(
      SYNTHETIC_USER_ID,
      aProposal({ id: 'prop_a', baseRevision: aRevision(5) }),
    );
    ports.proposals.seed(
      SYNTHETIC_USER_ID,
      aProposal({ id: 'prop_b', baseRevision: aRevision(5) }),
    );

    await Promise.all([
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: 'prop_a',
        decision: 'accept',
      }),
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: 'prop_b',
        decision: 'accept',
      }),
    ]);

    const statuses = [
      (await ports.proposals.findById(SYNTHETIC_USER_ID, 'prop_a'))?.status,
      (await ports.proposals.findById(SYNTHETIC_USER_ID, 'prop_b'))?.status,
    ].sort();

    expect(statuses).toEqual(['accepted', 'rejected_stale']);
  });

  it('refuses a second decision on the same proposal, even concurrently', async () => {
    const ports = createTestPorts();
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(
      SYNTHETIC_USER_ID,
      aProposal({ id: 'prop_a', baseRevision: aRevision(5) }),
    );

    const results = await Promise.all([
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: 'prop_a',
        decision: 'accept',
      }),
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: 'prop_a',
        decision: 'accept',
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const failure = results.find((result) => !result.ok);
    expect(failure?.ok).toBe(false);
  });

  it('does not advance the revision when a proposal is merely rejected', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(true);
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(5);
  });
});

describe('the stale marker survives a second revision move', () => {
  /**
   * The double race the first fix missed.
   *
   * Detecting staleness and RECORDING it were two separate compare-and-sets against
   * the revision. If the plan moved a second time between them, the stale write was
   * itself refused, and the proposal stayed `pending` - still offered for review,
   * still carrying a base revision that can never match again.
   *
   * Marking stale is a status-only transition. It is correct regardless of what the
   * revision is doing, so it must not be conditioned on the revision at all.
   */

  it('marks stale even when the revision moves again during the stale write', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    // The plan moves again while the stale outcome is being recorded.
    ports.proposals.onBeforeMarkStale(() => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(7));
    });

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    expect(result.ok).toBe(false);
    const stored = await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id);
    expect(stored?.status).toBe('rejected_stale');
  });

  it('leaves no proposal reviewable after the revision moves twice', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    ports.proposals.onBeforeCommit(() => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    });
    ports.proposals.onBeforeMarkStale(() => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(7));
    });

    await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });

    const stored = await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id);
    expect(stored?.status).toBe('rejected_stale');

    // And it cannot be reviewed again.
    const second = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'accept',
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toEqual({ kind: 'already_decided', status: 'rejected_stale' });
  });

  it('never overwrites a decision that was already made', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5), status: 'accepted' });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(9));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    expect(await ports.proposals.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe(
      'not_pending',
    );
    expect((await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
      'accepted',
    );
  });

  it('reports not_found for an unknown proposal', async () => {
    const ports = createTestPorts();
    expect(await ports.proposals.markStaleIfPending(SYNTHETIC_USER_ID, 'nope')).toBe('not_found');
  });

  it('is idempotent: marking an already-stale proposal changes nothing', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    expect(await ports.proposals.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe('marked');
    expect(await ports.proposals.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id)).toBe(
      'not_pending',
    );
    expect((await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
      'rejected_stale',
    );
  });

  it('does not touch the plan revision', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    await ports.proposals.markStaleIfPending(SYNTHETIC_USER_ID, proposal.id);

    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(6);
  });
});

/**
 * Registers a hook on BOTH decision-write paths. The race then happens whichever path
 * a rejection takes, so these tests fail on a regression that routes rejection back
 * through the revision compare-and-set, rather than passing because a hook never fired.
 */
function inCommitWindow(ports: ReturnType<typeof createTestPorts>, hook: () => void) {
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    hook();
  };
  ports.proposals.onBeforeReject(once);
  ports.proposals.onBeforeCommit(once);
}

describe('explicit rejection is independent of the plan revision', () => {
  /**
   * A user who rejects a proposal has made a decision about its CONTENT. Routing that
   * decision through the revision compare-and-set meant a plan change landing inside
   * the commit window silently converted "the user rejected this" into "this went
   * stale" - a different terminal status, and a record of a decision nobody made.
   *
   * Rejection is therefore a status-only compare-and-set: pending to rejected, or
   * nothing. It keeps the status check, so it can never overwrite a decision that was
   * already made.
   */

  it('records the rejection even when the revision moves inside the commit window', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    inCommitWindow(ports, () => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    });

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(true);
    expect((await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
      'rejected',
    );
  });

  it('records the rejection when the revision moves repeatedly around it', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);
    inCommitWindow(ports, () => {
      ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(9));
    });

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(true);
    expect((await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
      'rejected',
    );
    // Rejecting never advances the plan; the moves above are someone else's.
    expect(await ports.proposals.currentRevision(SYNTHETIC_USER_ID)).toBe(9);
  });

  it('does not read the plan revision at all when rejecting', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);
    ports.proposals.currentRevision = () =>
      Promise.reject(new Error('rejection must not depend on the plan revision'));

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(true);
  });

  it('keeps the status compare-and-set: a proposal decided first is never overwritten', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    // Someone accepts it inside the rejection's window.
    inCommitWindow(ports, () => {
      ports.proposals.seed(SYNTHETIC_USER_ID, { ...proposal, status: 'accepted' });
    });

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'already_decided', status: 'accepted' });
    expect((await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
      'accepted',
    );
  });

  it('lets exactly one of a concurrent accept and reject win, consistently', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(5));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const [accepted, rejected] = await Promise.all([
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: proposal.id,
        decision: 'accept',
      }),
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: proposal.id,
        decision: 'reject',
      }),
    ]);

    expect([accepted.ok, rejected.ok].filter(Boolean)).toHaveLength(1);
    const stored = await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id);
    const revision = await ports.proposals.currentRevision(SYNTHETIC_USER_ID);

    if (accepted.ok) {
      expect(stored?.status).toBe('accepted');
      expect(revision).toBe(6);
    } else {
      expect(stored?.status).toBe('rejected');
      expect(revision).toBe(5);
    }
  });

  it('lets exactly one of a stale marking and a rejection win, and never leaves it pending', async () => {
    const ports = createTestPorts();
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.setRevision(SYNTHETIC_USER_ID, aRevision(6));
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const [staleAttempt, rejection] = await Promise.all([
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: proposal.id,
        decision: 'accept',
      }),
      reviewProposal(ports, {
        userId: SYNTHETIC_USER_ID,
        proposalId: proposal.id,
        decision: 'reject',
      }),
    ]);

    expect(staleAttempt.ok).toBe(false);
    const status = (await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status;
    expect(['rejected', 'rejected_stale']).toContain(status);
    expect(rejection.ok).toBe(status === 'rejected');
  });

  it('still refuses to reject an expired proposal', async () => {
    const ports = createTestPorts(new Date('2026-09-18T10:00:00.000Z'));
    const proposal = aProposal({ baseRevision: aRevision(5) });
    ports.proposals.seed(SYNTHETIC_USER_ID, proposal);

    const result = await reviewProposal(ports, {
      userId: SYNTHETIC_USER_ID,
      proposalId: proposal.id,
      decision: 'reject',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('expired');
    expect((await ports.proposals.findById(SYNTHETIC_USER_ID, proposal.id))?.status).toBe(
      'pending',
    );
  });
});
