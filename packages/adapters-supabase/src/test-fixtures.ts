/**
 * Fixtures for the provider suites, anchored to one instant per run.
 *
 * Times are relative rather than written down. A fixed future date is a test that starts failing
 * on a particular day - a proposal seeded with `expires_at: '2026-09-26'` is valid until it
 * silently is not, and the case then proves the opposite of what it says. Every time here is an
 * offset from `RUN_STARTED_AT`, captured once, so a run is internally consistent and the
 * relationships the invariants are about (an expiry in the future, a set after its session began)
 * hold whenever it runs.
 *
 * Used only by `*.provider.ts` suites, which `pnpm verify` does not run.
 */

/** Captured once per process, so every offset in a run shares one origin. */
export const RUN_STARTED_AT = Date.now();

/** An ISO instant, `minutes` from this run's origin. Negative is in the past. */
export function at(minutes: number): string {
  return new Date(RUN_STARTED_AT + minutes * 60_000).toISOString();
}

export const EXERCISE = {
  /** Unilateral, and not permitted to record a combined load. */
  perSide: 'split-squat',
  /** Unilateral, and explicitly permitted to record a combined total. */
  combined: 'farmer-carry',
} as const;

export const SCHEDULED_SESSION_ID = 'session-mon';

/**
 * A scheduled session as the plan holds it, which is where the server derives a workout
 * session's exercises and combined-load permission from (I-14, ADR-0012).
 */
export const SCHEDULED_SESSION = {
  id: SCHEDULED_SESSION_ID,
  scheduledFor: '2026-09-21',
  exercises: [
    {
      exerciseId: EXERCISE.perSide,
      prescription: {
        schemaVersion: 1,
        profile: 'unilateral_strength',
        side: 'left',
        loadSemantics: 'per_side',
        repetitions: 8,
      },
    },
    {
      exerciseId: EXERCISE.combined,
      prescription: { schemaVersion: 1, profile: 'strength', repetitions: 6 },
      combinedLoadPermitted: true,
    },
  ],
} as const;

/** The exercises that session prescribes, in the order the plan lists them. */
export const PRESCRIBED_EXERCISES = [EXERCISE.perSide, EXERCISE.combined];
export const COMBINED_LOAD_EXERCISES = [EXERCISE.combined];

/** An active plan row carrying that scheduled session. */
export function aPlanRow(
  userId: string,
  options: { id: string; revision: number; name?: string; sessions?: readonly unknown[] },
): Record<string, unknown> {
  return {
    user_id: userId,
    id: options.id,
    revision: options.revision,
    status: 'active',
    activated_at: at(-24 * 60),
    sessions: options.sessions ?? [SCHEDULED_SESSION],
    ...(options.name === undefined ? {} : { name: options.name }),
  };
}

/** A pending proposal row whose expiry is genuinely in the future. */
export function aProposalRow(
  userId: string,
  options: { id: string; baseRevision: number } & Record<string, unknown>,
): Record<string, unknown> {
  const { id, baseRevision, ...overrides } = options;
  return {
    user_id: userId,
    id,
    base_revision: baseRevision,
    // A replacement the wire contract accepts: at least one session, because an empty plan is a
    // deletion wearing a replacement's clothes (packages/contracts/src/plan-diff.ts).
    diff: { op: 'replace_plan', sessions: [SCHEDULED_SESSION] },
    rationale: 'because',
    status: 'pending',
    created_at: at(-60),
    decided_at: null,
    actor_client_id: 'client',
    actor_agent_id: 'agent',
    input_hash: 'hash',
    expires_at: at(24 * 60),
    ...overrides,
  };
}

/** A strength measurement the domain would accept. */
export const A_MEASUREMENT = {
  schemaVersion: 1,
  profile: 'strength',
  repetitions: 8,
  load: { unit: 'kg', value: 40 },
} as const;
