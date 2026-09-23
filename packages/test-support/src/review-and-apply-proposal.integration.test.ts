import { reviewAndApplyProposal } from '@workout/application';
import { describe, expect, it } from 'vitest';
import { aProposal, aRevision, SYNTHETIC_USER_ID } from './builders.js';
import { createTestPorts } from './in-memory-ports.js';
import { InMemoryPlanReader } from './in-memory-workout.js';
import { aPlan } from './local-workout-store-cases.js';

const user = SYNTHETIC_USER_ID;

describe('reviewAndApplyProposal', () => {
  it('applies a replace_plan diff and advances the plan revision on accept', async () => {
    const proposals = createTestPorts().proposals;
    const plans = new InMemoryPlanReader();
    const plan = aPlan();
    plans.setActivePlan(user, plan);
    proposals.setRevision(user, aRevision(1));
    const proposal = aProposal({ baseRevision: aRevision(1) });
    proposals.seed(user, proposal);

    const result = await reviewAndApplyProposal(
      { proposals, plans, clock: { now: () => new Date('2026-09-16T12:00:00Z') } },
      { userId: user, proposalId: proposal.id, decision: 'accept' },
    );

    expect(result.ok).toBe(true);
    const stored = await plans.activePlan(user);
    expect(stored?.revision).toBe(2);
    expect(stored?.sessions.map((session) => session.id)).toEqual(['sess_synthetic_01']);
    expect((await proposals.findById(user, proposal.id))?.status).toBe('accepted');
  });

  it('refuses accept when there is no active plan and leaves the proposal pending', async () => {
    const proposals = createTestPorts().proposals;
    const plans = new InMemoryPlanReader();
    proposals.setRevision(user, aRevision(1));
    const proposal = aProposal({ baseRevision: aRevision(1) });
    proposals.seed(user, proposal);

    const result = await reviewAndApplyProposal(
      { proposals, plans, clock: { now: () => new Date('2026-09-16T12:00:00Z') } },
      { userId: user, proposalId: proposal.id, decision: 'accept' },
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error.kind).toBe('no_active_plan');
    expect((await proposals.findById(user, proposal.id))?.status).toBe('pending');
    expect(await proposals.currentRevision(user)).toBe(1);
  });

  it('refuses a correct_completed_session accept without accepting or advancing revision', async () => {
    const proposals = createTestPorts().proposals;
    const plans = new InMemoryPlanReader();
    plans.setActivePlan(user, aPlan());
    proposals.setRevision(user, aRevision(1));
    const proposal = aProposal({
      baseRevision: aRevision(1),
      // builders only set replace_plan; override via seed shape
    });
    const correction = {
      ...proposal,
      diff: {
        op: 'correct_completed_session' as const,
        sessionId: 'session-mon',
        corrections: [],
      },
    };
    proposals.seed(user, correction);

    const result = await reviewAndApplyProposal(
      { proposals, plans, clock: { now: () => new Date('2026-09-16T12:00:00Z') } },
      { userId: user, proposalId: correction.id, decision: 'accept' },
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toEqual({
      kind: 'not_a_plan_change',
      op: 'correct_completed_session',
    });
    expect((await proposals.findById(user, correction.id))?.status).toBe('pending');
    expect(await proposals.currentRevision(user)).toBe(1);
    expect((await plans.activePlan(user))?.sessions.map((session) => session.id)).toEqual([
      'session-mon',
    ]);
  });
});
