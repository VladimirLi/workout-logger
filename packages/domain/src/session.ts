import type { CorrectionRevision } from './correction-revision.js';
import {
  LOAD_SEMANTICS,
  MEASUREMENT_SCHEMA_VERSION,
  type Measurement,
  SIDES,
} from './measurement.js';
import { findScheduledSession, type Plan } from './plan.js';
import { err, ok, type Result } from './result.js';
import type { Revision } from './revision.js';

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
    status: 'active',
    startedAt: input.startedAt,
    sets: [],
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuantity(candidate: unknown, expectedUnit: string): boolean {
  if (!isRecord(candidate)) return false;
  const { unit, value } = candidate;
  return unit === expectedUnit && typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function optionalQuantity(value: unknown, unit: string): boolean {
  return value === undefined || isQuantity(value, unit);
}

/**
 * Runtime shape check for a measurement of the current schema version. The factories in
 * measurement.ts validate ranges; this guards the boundary where a value was not built by them.
 */
export function isMeasurement(candidate: unknown): candidate is Measurement {
  if (!isRecord(candidate)) return false;
  const { schemaVersion, profile, repetitions, load, side, loadSemantics, duration, distance } =
    candidate;
  if (schemaVersion !== MEASUREMENT_SCHEMA_VERSION) return false;
  switch (profile) {
    case 'strength':
      return isPositiveInteger(repetitions) && optionalQuantity(load, 'kg');
    case 'unilateral_strength':
      return (
        isPositiveInteger(repetitions) &&
        optionalQuantity(load, 'kg') &&
        (SIDES as readonly unknown[]).includes(side) &&
        (LOAD_SEMANTICS as readonly unknown[]).includes(loadSemantics)
      );
    case 'cardio':
      return isQuantity(duration, 's') && optionalQuantity(distance, 'm');
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
