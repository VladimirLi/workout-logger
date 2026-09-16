import { describe, expect, it } from 'vitest';
import { PLAN_DIFF_OPERATIONS, planDiffSchema } from './plan-diff.js';
import { proposalSchema } from './proposal.js';

/**
 * The proposal diff was `z.unknown()`, which meant the one field carrying what an
 * agent actually wants to change was the only field with no contract at all. An
 * agent could post any shape, and the user would be asked to approve something the
 * system had never validated.
 *
 * The diff is now a closed discriminated union over exactly the operations the
 * first slice supports (R-021). Anything else is refused at the boundary.
 */

const SESSION = {
  id: 'sess_01',
  scheduledFor: '2026-09-20',
  exercises: [
    {
      exerciseId: 'ex_bench',
      prescription: { profile: 'strength', schemaVersion: 1, repetitions: 5 },
    },
  ],
};

const VALID: Record<string, unknown> = {
  replace_plan: { op: 'replace_plan', sessions: [SESSION] },
  change_scheduled_session: {
    op: 'change_scheduled_session',
    sessionId: 'sess_01',
    scheduledFor: '2026-09-21',
  },
  change_exercise_prescription: {
    op: 'change_exercise_prescription',
    sessionId: 'sess_01',
    exerciseId: 'ex_bench',
    prescription: { profile: 'strength', schemaVersion: 1, repetitions: 8 },
  },
  correct_completed_session: {
    op: 'correct_completed_session',
    sessionId: 'sess_01',
    corrections: [
      { setId: 'set_01', measurement: { profile: 'strength', schemaVersion: 1, repetitions: 5 } },
    ],
  },
};

describe('supported operations', () => {
  it('declares exactly the first-slice operations', () => {
    expect([...PLAN_DIFF_OPERATIONS]).toEqual([
      'replace_plan',
      'change_scheduled_session',
      'change_exercise_prescription',
      'correct_completed_session',
    ]);
  });

  it.each(Object.keys(VALID))('accepts a well-formed %s diff', (op) => {
    const result = planDiffSchema.safeParse(VALID[op]);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });
});

describe('arbitrary shapes are refused', () => {
  it.each([
    ['a bare object', {}],
    ['a string', 'delete everything'],
    ['a number', 42],
    ['null', null],
    ['an array', [{ op: 'replace_plan', sessions: [] }]],
    ['an unknown operation', { op: 'delete_all_history' }],
    ['a SQL-shaped payload', { op: 'raw', sql: 'DROP TABLE sessions' }],
    ['a JSON-patch-shaped payload', [{ op: 'remove', path: '/sessions/0' }]],
  ])('rejects %s', (_label, value) => {
    expect(planDiffSchema.safeParse(value).success).toBe(false);
  });

  it.each(Object.keys(VALID))('rejects an unknown key added to a valid %s diff', (op) => {
    const withExtra = { ...(VALID[op] as object), escalate: true };
    expect(planDiffSchema.safeParse(withExtra).success).toBe(false);
  });

  it('rejects an unknown key nested inside a session', () => {
    const result = planDiffSchema.safeParse({
      op: 'replace_plan',
      sessions: [{ ...SESSION, force: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown key nested inside a prescription', () => {
    const result = planDiffSchema.safeParse({
      op: 'change_exercise_prescription',
      sessionId: 'sess_01',
      exerciseId: 'ex_bench',
      prescription: { profile: 'strength', schemaVersion: 1, repetitions: 8, secret: 1 },
    });
    expect(result.success).toBe(false);
  });
});

describe('bounds', () => {
  it('caps the number of sessions a single proposal may replace', () => {
    const many = Array.from({ length: 200 }, (_, index) => ({ ...SESSION, id: `sess_${index}` }));
    expect(planDiffSchema.safeParse({ op: 'replace_plan', sessions: many }).success).toBe(false);
  });

  it('caps the number of corrections in one proposal', () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      setId: `set_${index}`,
      measurement: { profile: 'strength', schemaVersion: 1, repetitions: 5 },
    }));
    expect(
      planDiffSchema.safeParse({
        op: 'correct_completed_session',
        sessionId: 's',
        corrections: many,
      }).success,
    ).toBe(false);
  });

  it('rejects an empty correction list, which would be a proposal that changes nothing', () => {
    expect(
      planDiffSchema.safeParse({
        op: 'correct_completed_session',
        sessionId: 'sess_01',
        corrections: [],
      }).success,
    ).toBe(false);
  });

  it('rejects an unbounded identifier', () => {
    expect(
      planDiffSchema.safeParse({
        op: 'change_scheduled_session',
        sessionId: 'x'.repeat(5_000),
        scheduledFor: '2026-09-21',
      }).success,
    ).toBe(false);
  });

  it('rejects a malformed scheduled date', () => {
    expect(
      planDiffSchema.safeParse({
        op: 'change_scheduled_session',
        sessionId: 'sess_01',
        scheduledFor: 'next tuesday',
      }).success,
    ).toBe(false);
  });
});

describe('the proposal contract uses the closed diff', () => {
  const base = {
    id: 'prop_01',
    actor: { clientId: 'c', actorId: 'a' },
    baseRevision: 7,
    rationale: 'Deload.',
    inputHash: `sha256:${'a'.repeat(64)}`,
    createdAt: '2026-09-16T10:00:00.000Z',
    expiresAt: '2026-09-16T11:00:00.000Z',
    status: 'pending',
  };

  it('accepts a proposal carrying a valid diff', () => {
    expect(proposalSchema.safeParse({ ...base, diff: VALID.replace_plan }).success).toBe(true);
  });

  it('rejects a proposal carrying an arbitrary diff', () => {
    expect(proposalSchema.safeParse({ ...base, diff: { anything: 'goes' } }).success).toBe(false);
  });

  it('rejects a proposal with no diff at all', () => {
    expect(proposalSchema.safeParse(base).success).toBe(false);
  });
});
