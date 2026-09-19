import type { CorrectionRevision } from './correction-revision.js';
import { BORG_MAX, BORG_MIN, deriveRpe, RIR_MAX, RIR_MIN } from './exertion.js';
import {
  LOAD_SEMANTICS,
  MAX_INCLINE_PERCENT,
  MAX_NOTES_LENGTH,
  MEASUREMENT_SCHEMA_VERSION,
  type Measurement,
  MIN_INCLINE_PERCENT,
  SIDES,
} from './measurement.js';
import { findScheduledSession, type Plan } from './plan.js';
import { err, ok, type Result } from './result.js';
import type { Revision } from './revision.js';
import { MAXIMUM_BY_UNIT, type Unit } from './units.js';

/**
 * A workout session (workout-logging spec, R-005, ADR-0004).
 *
 * A session follows one scheduled session of the active plan and records what actually
 * happened. Every result is a typed measurement: the type has no numeric field to put a bare
 * value in, and `recordSet` refuses anything that is not a well-formed measurement at runtime
 * too, because recorded data arrives from storage and the network as well as from code.
 *
 * Sessions are values. Recording returns a new session and leaves the previous one untouched.
 */

export interface RecordedSet {
  readonly setId: string;
  readonly exerciseId: string;
  /** 1-based order of recording within the session. */
  readonly sequence: number;
  readonly measurement: Measurement;
  readonly recordedAt: Date;
}

interface SessionBase {
  readonly id: string;
  readonly planId: string;
  /** The plan revision the session was started from. */
  readonly planRevision: Revision;
  readonly scheduledSessionId: string;
  /** The exercises the scheduled session prescribed when the session started. */
  readonly exerciseIds: readonly string[];
  /**
   * The exercises that were configured to permit combined load when the session started.
   *
   * Snapshotted rather than read from the plan at recording time: a plan edited mid-workout
   * must not change what the set the user is about to record is allowed to mean.
   */
  readonly combinedLoadExercises: readonly string[];
  readonly startedAt: Date;
  readonly sets: readonly RecordedSet[];
}

export interface ActiveSession extends SessionBase {
  readonly status: 'active';
}

export interface CompletedSession extends SessionBase {
  readonly status: 'completed';
  readonly completedAt: Date;
  /** Present once the server has accepted the session; its facts are then immutable. */
  readonly synchronizedAt?: Date;
  /** Starts at 1 and advances with each audited correction (correction.ts). */
  readonly factsRevision: Revision;
  readonly corrections: readonly CorrectionRevision[];
}

export type WorkoutSession = ActiveSession | CompletedSession;

export type SessionError =
  | { readonly kind: 'plan_not_active'; readonly planId: string }
  | { readonly kind: 'scheduled_session_not_found'; readonly scheduledSessionId: string }
  | { readonly kind: 'session_not_active'; readonly sessionId: string }
  | { readonly kind: 'exercise_not_in_session'; readonly exerciseId: string }
  | { readonly kind: 'combined_load_not_permitted'; readonly exerciseId: string }
  | { readonly kind: 'duplicate_set'; readonly setId: string }
  | { readonly kind: 'not_a_measurement'; readonly setId: string }
  | { readonly kind: 'recorded_before_start'; readonly setId: string }
  | { readonly kind: 'completed_before_start'; readonly sessionId: string };

export interface StartSessionInput {
  readonly id: string;
  readonly scheduledSessionId: string;
  readonly startedAt: Date;
}

export function startSession(
  plan: Plan,
  input: StartSessionInput,
): Result<ActiveSession, SessionError> {
  if (plan.status !== 'active') return err({ kind: 'plan_not_active', planId: plan.id });
  const scheduled = findScheduledSession(plan, input.scheduledSessionId);
  if (!scheduled) {
    return err({
      kind: 'scheduled_session_not_found',
      scheduledSessionId: input.scheduledSessionId,
    });
  }
  return ok({
    id: input.id,
    planId: plan.id,
    planRevision: plan.revision,
    scheduledSessionId: scheduled.id,
    exerciseIds: scheduled.exercises.map((exercise) => exercise.exerciseId),
    combinedLoadExercises: scheduled.exercises
      .filter((exercise) => exercise.combinedLoadPermitted === true)
      .map((exercise) => exercise.exerciseId),
    status: 'active',
    startedAt: input.startedAt,
    sets: [],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Only the keys the shape defines, so a field nobody understands cannot ride along (R-021). */
function hasOnly(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(candidate).every((key) => keys.includes(key));
}

function isQuantity(candidate: unknown, expectedUnit: Unit): boolean {
  if (!isRecord(candidate)) return false;
  const { unit, value } = candidate;
  return (
    unit === expectedUnit &&
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    // The bound the constructor applies. A value `quantity()` would refuse must not become
    // valid by arriving as JSON.
    value <= MAXIMUM_BY_UNIT[expectedUnit] &&
    hasOnly(candidate, ['unit', 'value'])
  );
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function optionalQuantity(value: unknown, unit: Unit): boolean {
  return value === undefined || isQuantity(value, unit);
}

function areNotes(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= MAX_NOTES_LENGTH);
}

function isHalfStep(value: number): boolean {
  return Number.isInteger(value * 2);
}

/**
 * A strength exertion, including the relationship between its two fields.
 *
 * RPE is derived from RIR, never entered (ADR-0004). Validating them independently would let a
 * record assert RIR 2 with RPE 1 - two different efforts at once - which is exactly what the
 * wire contract refuses in packages/contracts/src/measurement.ts.
 */
function isStrengthExertion(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnly(value, ['profile', 'rir', 'rpe'])) return false;
  if (value['profile'] !== 'strength') return false;
  const rir = value['rir'];
  const rpe = value['rpe'];
  if (!isRecord(rir) || !hasOnly(rir, ['kind', 'value']) || rir['kind'] !== 'rir') return false;
  if (!isRecord(rpe) || !hasOnly(rpe, ['kind', 'value']) || rpe['kind'] !== 'rpe_derived') {
    return false;
  }
  const rirValue = rir['value'];
  const rpeValue = rpe['value'];
  if (typeof rirValue !== 'number' || !Number.isFinite(rirValue)) return false;
  if (rirValue < RIR_MIN || rirValue > RIR_MAX || !isHalfStep(rirValue)) return false;
  if (typeof rpeValue !== 'number') return false;
  return rpeValue === deriveRpe({ kind: 'rir', value: rirValue }).value;
}

function isCardioExertion(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value) || !hasOnly(value, ['profile', 'borg'])) return false;
  if (value['profile'] !== 'cardio') return false;
  const borg = value['borg'];
  return typeof borg === 'number' && Number.isInteger(borg) && borg >= BORG_MIN && borg <= BORG_MAX;
}

function isIncline(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= MIN_INCLINE_PERCENT &&
      value <= MAX_INCLINE_PERCENT)
  );
}

/**
 * Runtime shape check for a measurement of the current schema version.
 *
 * This is the domain's half of one contract, and it has to be the WHOLE contract: the same
 * fields, bounds and closed key sets that packages/contracts validates on the wire and the
 * database validates before it stores the JSON. A field this check walks past is a field that
 * reaches storage unvalidated, however carefully the factories in measurement.ts were written -
 * measurements arrive from IndexedDB and from the network as well as from code.
 */
export function isMeasurement(candidate: unknown): candidate is Measurement {
  if (!isRecord(candidate)) return false;
  const { schemaVersion, profile, repetitions, load, side, loadSemantics, duration, distance } =
    candidate;
  if (schemaVersion !== MEASUREMENT_SCHEMA_VERSION) return false;
  if (!areNotes(candidate['notes'])) return false;

  switch (profile) {
    case 'strength':
      return (
        hasOnly(candidate, [
          'schemaVersion',
          'profile',
          'repetitions',
          'load',
          'exertion',
          'notes',
        ]) &&
        isPositiveInteger(repetitions) &&
        optionalQuantity(load, 'kg') &&
        isStrengthExertion(candidate['exertion'])
      );
    case 'unilateral_strength':
      return (
        hasOnly(candidate, [
          'schemaVersion',
          'profile',
          'side',
          'loadSemantics',
          'repetitions',
          'load',
          'exertion',
          'notes',
        ]) &&
        isPositiveInteger(repetitions) &&
        optionalQuantity(load, 'kg') &&
        (SIDES as readonly unknown[]).includes(side) &&
        (LOAD_SEMANTICS as readonly unknown[]).includes(loadSemantics) &&
        isStrengthExertion(candidate['exertion'])
      );
    case 'cardio':
      return (
        hasOnly(candidate, [
          'schemaVersion',
          'profile',
          'duration',
          'distance',
          'inclinePercent',
          'exertion',
          'notes',
        ]) &&
        isQuantity(duration, 's') &&
        optionalQuantity(distance, 'm') &&
        isIncline(candidate['inclinePercent']) &&
        isCardioExertion(candidate['exertion'])
      );
    default:
      return false;
  }
}

export interface RecordSetInput {
  readonly setId: string;
  readonly exerciseId: string;
  readonly measurement: Measurement;
  readonly recordedAt: Date;
}

export function recordSet(
  session: WorkoutSession,
  input: RecordSetInput,
): Result<ActiveSession, SessionError> {
  if (session.status !== 'active')
    return err({ kind: 'session_not_active', sessionId: session.id });
  if (!isMeasurement(input.measurement))
    return err({ kind: 'not_a_measurement', setId: input.setId });
  if (!session.exerciseIds.includes(input.exerciseId)) {
    return err({ kind: 'exercise_not_in_session', exerciseId: input.exerciseId });
  }
  if (session.sets.some((set) => set.setId === input.setId)) {
    return err({ kind: 'duplicate_set', setId: input.setId });
  }
  if (input.recordedAt.getTime() < session.startedAt.getTime()) {
    return err({ kind: 'recorded_before_start', setId: input.setId });
  }
  // Combined load is a claim about what the number means, so it is refused unless the plan
  // said this exercise may make it (owner decision 2026-09-18).
  if (
    input.measurement.profile === 'unilateral_strength' &&
    input.measurement.loadSemantics === 'total' &&
    !session.combinedLoadExercises.includes(input.exerciseId)
  ) {
    return err({ kind: 'combined_load_not_permitted', exerciseId: input.exerciseId });
  }
  const recorded: RecordedSet = {
    setId: input.setId,
    exerciseId: input.exerciseId,
    sequence: session.sets.length + 1,
    measurement: input.measurement,
    recordedAt: input.recordedAt,
  };
  return ok({ ...session, sets: [...session.sets, recorded] });
}

export function completeSession(
  session: WorkoutSession,
  completedAt: Date,
): Result<CompletedSession, SessionError> {
  if (session.status !== 'active')
    return err({ kind: 'session_not_active', sessionId: session.id });
  if (completedAt.getTime() < session.startedAt.getTime()) {
    return err({ kind: 'completed_before_start', sessionId: session.id });
  }
  return ok({
    ...session,
    status: 'completed',
    completedAt,
    factsRevision: 1 as Revision,
    corrections: [],
  });
}
