import type { Measurement } from './measurement.js';

/**
 * The closed set of changes an agent may propose (R-021, ADR-0002).
 *
 * The diff was previously opaque to the domain, which meant the one field
 * describing what would actually change was the only part of a proposal with no
 * shape at all. The user would then be asked to approve it.
 *
 * These are TYPES only - no runtime validation and no imports beyond the domain,
 * so packages/domain stays pure. The wire-level validation lives in
 * @workout/contracts, and a test asserts the two agree.
 */

export const PLAN_DIFF_OPERATIONS = [
  'replace_plan',
  'change_scheduled_session',
  'change_exercise_prescription',
  'correct_completed_session',
] as const;

export type PlanDiffOperation = (typeof PLAN_DIFF_OPERATIONS)[number];

/** An ISO calendar date, `YYYY-MM-DD`. Sessions are scheduled by day, not instant. */
export type CalendarDate = string;

export interface ExercisePrescription {
  readonly exerciseId: string;
  /** The target for this exercise, typed by measurement profile. */
  readonly prescription: Measurement;
}

export interface ScheduledSession {
  readonly id: string;
  readonly scheduledFor: CalendarDate;
  readonly exercises: readonly ExercisePrescription[];
}

export interface SetCorrection {
  readonly setId: string;
  readonly measurement: Measurement;
}

export interface ReplacePlanDiff {
  readonly op: 'replace_plan';
  readonly sessions: readonly ScheduledSession[];
}

export interface ChangeScheduledSessionDiff {
  readonly op: 'change_scheduled_session';
  readonly sessionId: string;
  readonly scheduledFor?: CalendarDate;
  readonly exercises?: readonly ExercisePrescription[];
}

export interface ChangeExercisePrescriptionDiff {
  readonly op: 'change_exercise_prescription';
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly prescription: Measurement;
}

export interface CorrectCompletedSessionDiff {
  readonly op: 'correct_completed_session';
  readonly sessionId: string;
  readonly corrections: readonly SetCorrection[];
}

export type PlanDiff =
  | ReplacePlanDiff
  | ChangeScheduledSessionDiff
  | ChangeExercisePrescriptionDiff
  | CorrectCompletedSessionDiff;

/**
 * Exhaustiveness helper. Adding a fifth operation without handling it is a compile
 * error, which is the cheapest place to find out.
 */
export function assertNeverPlanDiff(value: never): never {
  throw new Error(`Unhandled plan diff operation: ${JSON.stringify(value)}`);
}
