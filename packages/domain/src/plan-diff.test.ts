import { describe, expect, it } from 'vitest';
import { assertNeverPlanDiff, PLAN_DIFF_OPERATIONS, type PlanDiff } from './plan-diff.js';

describe('plan diff operations', () => {
  it('declares exactly the first-slice operations', () => {
    expect([...PLAN_DIFF_OPERATIONS]).toEqual([
      'replace_plan',
      'change_scheduled_session',
      'change_exercise_prescription',
      'correct_completed_session',
    ]);
  });

  it('is exhaustively switchable, so a new operation is a compile error', () => {
    const diffs: PlanDiff[] = [
      { op: 'replace_plan', sessions: [] },
      { op: 'change_scheduled_session', sessionId: 's', scheduledFor: '2026-09-20' },
      {
        op: 'change_exercise_prescription',
        sessionId: 's',
        exerciseId: 'e',
        prescription: { profile: 'strength', schemaVersion: 1, repetitions: 5 },
      },
      { op: 'correct_completed_session', sessionId: 's', corrections: [] },
    ];

    const labels = diffs.map((diff) => {
      switch (diff.op) {
        case 'replace_plan':
          return `replace:${diff.sessions.length}`;
        case 'change_scheduled_session':
          return `session:${diff.sessionId}`;
        case 'change_exercise_prescription':
          return `exercise:${diff.exerciseId}`;
        case 'correct_completed_session':
          return `corrections:${diff.corrections.length}`;
        default:
          return assertNeverPlanDiff(diff);
      }
    });

    expect(labels).toEqual(['replace:0', 'session:s', 'exercise:e', 'corrections:0']);
  });

  it('throws from the exhaustiveness guard if an unhandled operation reaches it', () => {
    // Reachable only if an operation is added without updating a switch. The guard
    // exists so that mistake fails loudly at runtime as well as at compile time.
    expect(() => assertNeverPlanDiff({ op: 'delete_plan' } as never)).toThrow(
      /Unhandled plan diff operation/,
    );
  });
});
