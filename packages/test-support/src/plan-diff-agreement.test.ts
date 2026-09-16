import {
  PLAN_DIFF_OPERATIONS as CONTRACT_OPERATIONS,
  type PlanDiffPayload,
  planDiffSchema,
} from '@workout/contracts';
import { PLAN_DIFF_OPERATIONS as DOMAIN_OPERATIONS, type PlanDiff } from '@workout/domain';
import { describe, expect, it } from 'vitest';

/**
 * The domain owns the PlanDiff TYPES and the contracts package owns their wire
 * validation, because packages/domain may not depend on a schema library
 * (ADR-0001). That split is only safe if the two cannot drift.
 *
 * This asserts agreement in both directions: structurally at compile time, and by
 * operation set at runtime.
 */

// Compile-time: anything the wire accepts must be representable in the domain.
// If the schema gains a field or an operation the domain does not model, or loosens
// a type, `pnpm typecheck` fails here.
type WireIsRepresentableInDomain = PlanDiffPayload extends PlanDiff ? true : never;
const _wireFitsDomain: WireIsRepresentableInDomain = true;

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
    expect(_wireFitsDomain).toBe(true);
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
