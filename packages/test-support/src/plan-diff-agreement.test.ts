import { PLAN_DIFF_OPERATIONS as CONTRACT_OPERATIONS, planDiffSchema } from '@workout/contracts';
import { PLAN_DIFF_OPERATIONS as DOMAIN_OPERATIONS, type PlanDiff } from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { planDiffWireMatchesDomain } from './plan-diff-agreement.js';

/**
 * Runtime half of the PlanDiff agreement.
 *
 * The compile-time half - structural equality between the domain types and the wire
 * schema, in both directions and at every nesting level - lives in
 * plan-diff-agreement.ts, which is included source and so is evaluated by
 * `pnpm typecheck`. It used to live here, where no tsconfig includes it and nothing
 * ever checked it.
 */

describe('plan diff agreement', () => {
  it('declares the same operations on both sides', () => {
    expect([...CONTRACT_OPERATIONS]).toEqual([...DOMAIN_OPERATIONS]);
  });

  it('validates a payload into a value the domain can hold', () => {
    const parsed = planDiffSchema.parse({
      op: 'change_exercise_prescription',
      sessionId: 'sess_01',
      exerciseId: 'ex_bench',
      prescription: { profile: 'strength', schemaVersion: 1, repetitions: 8 },
    });

    const held: PlanDiff = parsed;
    expect(held.op).toBe('change_exercise_prescription');
    // The value only exists if the typechecked source compiled with equality holding.
    expect(planDiffWireMatchesDomain).toBe(true);
  });

  it('covers every declared operation with a schema branch', () => {
    for (const op of DOMAIN_OPERATIONS) {
      // A missing branch would make the discriminated union reject the op outright
      // rather than complain about its fields.
      const issues = planDiffSchema.safeParse({ op });
      expect(issues.success).toBe(false);
      const message = JSON.stringify(issues.error?.issues ?? []);
      expect(message, `no schema branch for ${op}`).not.toMatch(/invalid_union_discriminator/);
    }
  });
});
