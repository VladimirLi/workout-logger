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

/** The longest a plan, session, or exercise name may be. Layouts are drawn for this length. */
export const MAX_NAME_LENGTH = 60;

/**
 * The seconds a lifter rests after a set of an exercise, whole and bounded so a typo cannot
 * schedule a rest that outlasts the workout.
 */
export const MIN_REST_SECONDS = 1;
export const MAX_REST_SECONDS = 3_600;

export interface ExercisePrescription {
  readonly exerciseId: string;
  /**
   * What the lifter calls this exercise ("Back squat"). Optional in stored data because plans
   * written before names existed have none; the interface then falls back to the identifier.
   */
  readonly name?: string;
  /** The target for this exercise, typed by measurement profile. */
  readonly prescription: Measurement;
  /**
   * Whether a unilateral result for this exercise may record its load as a combined total
   * rather than per side (owner decision 2026-09-18).
   *
   * Absent means no. "This load is what both sides moved together" is true of a trap-bar
   * carry and false of a split squat, and which one an exercise is cannot be guessed from the
   * number, so the plan says it or it is not available.
   */
  readonly combinedLoadPermitted?: boolean;
  /**
   * Rest after a set of this exercise, in whole seconds. Absent means the plan says nothing,
   * and the timer uses its own default.
   */
  readonly restSeconds?: number;
}

export interface ScheduledSession {
  readonly id: string;
  /** What the lifter calls this session ("Upper A"). */
  readonly name?: string;
  readonly scheduledFor: CalendarDate;
  readonly exercises: readonly ExercisePrescription[];
}

export interface SetCorrection {
  readonly setId: string;
  readonly measurement: Measurement;
}

export interface ReplacePlanDiff {
  readonly op: 'replace_plan';
  /** The plan's name. Absent leaves the plan's current name as it is. */
  readonly name?: string;
  readonly sessions: readonly ScheduledSession[];
}

export interface ChangeScheduledSessionDiff {
  readonly op: 'change_scheduled_session';
  readonly sessionId: string;
  readonly name?: string;
  readonly scheduledFor?: CalendarDate;
  readonly exercises?: readonly ExercisePrescription[];
}

export interface ChangeExercisePrescriptionDiff {
  readonly op: 'change_exercise_prescription';
  readonly sessionId: string;
  readonly exerciseId: string;
  readonly prescription: Measurement;
  /** Absent leaves the exercise's rest as it is. */
  readonly restSeconds?: number;
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
