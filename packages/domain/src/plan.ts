import type { Measurement } from './measurement.js';
import {
  assertNeverPlanDiff,
  type CalendarDate,
  type ExercisePrescription,
  type PlanDiff,
  type ScheduledSession,
} from './plan-diff.js';
import { err, ok, type Result } from './result.js';
import { nextRevision, type Revision } from './revision.js';

/**
 * The active workout plan (workout-planning spec, ADR-0002, D-018).
 *
 * At most one plan is active per user. A plan is its scheduled sessions and their typed
 * prescriptions, and nothing else: the first slice encodes no periodization and no
 * progression rule.
 *
 * The revision is the value an agent proposal is computed against, so every accepted change
 * to the plan or its sessions advances it, and reading never does. Activating a new plan also
 * advances past the superseded plan's revision, so a proposal made against the old plan can
 * never match the new one.
 *
 * Plans are values. A change returns a new plan and leaves the original untouched, which is
 * how a superseded plan keeps its history.
 */

const FIRST_REVISION = 1 as Revision;

export const PLAN_STATUSES = ['active', 'superseded'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

interface PlanBase {
  readonly id: string;
  readonly revision: Revision;
  readonly sessions: readonly ScheduledSession[];
  readonly activatedAt: Date;
}

export interface ActivePlan extends PlanBase {
  readonly status: 'active';
}

export interface SupersededPlan extends PlanBase {
  readonly status: 'superseded';
  readonly supersededAt: Date;
}

export type Plan = ActivePlan | SupersededPlan;

export type PlanError =
  | { readonly kind: 'plan_not_active'; readonly planId: string }
  | { readonly kind: 'session_not_found'; readonly sessionId: string }
  | { readonly kind: 'exercise_not_found'; readonly sessionId: string; readonly exerciseId: string }
  | { readonly kind: 'duplicate_session'; readonly sessionId: string }
  | { readonly kind: 'duplicate_exercise'; readonly sessionId: string; readonly exerciseId: string }
  | {
      readonly kind: 'invalid_scheduled_date';
      readonly sessionId: string;
      readonly received: string;
    };

export interface PlanDraft {
  readonly id: string;
  readonly sessions: readonly ScheduledSession[];
  readonly activatedAt: Date;
}

export interface PlanActivation {
  readonly activated: ActivePlan;
  /** The plan that was active before, now superseded with its history intact. */
  readonly superseded: SupersededPlan | undefined;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDate(value: CalendarDate): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function validateSession(session: ScheduledSession): PlanError | undefined {
  if (!isCalendarDate(session.scheduledFor)) {
    return {
      kind: 'invalid_scheduled_date',
      sessionId: session.id,
      received: session.scheduledFor,
    };
  }
  const seen = new Set<string>();
  for (const { exerciseId } of session.exercises) {
    if (seen.has(exerciseId)) {
      return { kind: 'duplicate_exercise', sessionId: session.id, exerciseId };
    }
    seen.add(exerciseId);
  }
  return undefined;
}

function validateSessions(sessions: readonly ScheduledSession[]): PlanError | undefined {
  const seen = new Set<string>();
  for (const session of sessions) {
    if (seen.has(session.id)) return { kind: 'duplicate_session', sessionId: session.id };
    seen.add(session.id);
    const problem = validateSession(session);
    if (problem) return problem;
  }
  return undefined;
}

/**
 * Activates a plan, superseding the one currently active, if any.
 *
 * The caller passes the currently active plan; the aggregate enforces that it really is active,
 * so two activations computed from the same stale read cannot both supersede it silently.
 */
export function activatePlan(
  current: Plan | undefined,
  draft: PlanDraft,
): Result<PlanActivation, PlanError> {
  if (current && current.status !== 'active') {
    return err({ kind: 'plan_not_active', planId: current.id });
  }
  const problem = validateSessions(draft.sessions);
  if (problem) return err(problem);

  const activated: ActivePlan = {
    id: draft.id,
    revision: current ? nextRevision(current.revision) : FIRST_REVISION,
    status: 'active',
    sessions: draft.sessions,
    activatedAt: draft.activatedAt,
  };
  const superseded: SupersededPlan | undefined = current
    ? { ...current, status: 'superseded', supersededAt: draft.activatedAt }
    : undefined;
  return ok({ activated, superseded });
}

/** Reading a session. Pure: it cannot advance the revision. */
export function findScheduledSession(plan: Plan, sessionId: string): ScheduledSession | undefined {
  return plan.sessions.find((session) => session.id === sessionId);
}

function withSessions(
  plan: Plan,
  sessions: readonly ScheduledSession[],
): Result<ActivePlan, PlanError> {
  if (plan.status !== 'active') return err({ kind: 'plan_not_active', planId: plan.id });
  const problem = validateSessions(sessions);
  if (problem) return err(problem);
  return ok({ ...plan, sessions, revision: nextRevision(plan.revision) });
}

export function changeExercisePrescription(
  plan: Plan,
  sessionId: string,
  exerciseId: string,
  prescription: Measurement,
): Result<ActivePlan, PlanError> {
  if (plan.status !== 'active') return err({ kind: 'plan_not_active', planId: plan.id });
  const session = findScheduledSession(plan, sessionId);
  if (!session) return err({ kind: 'session_not_found', sessionId });
  if (!session.exercises.some((exercise) => exercise.exerciseId === exerciseId)) {
    return err({ kind: 'exercise_not_found', sessionId, exerciseId });
  }
  const exercises: readonly ExercisePrescription[] = session.exercises.map((exercise) =>
    exercise.exerciseId === exerciseId ? { exerciseId, prescription } : exercise,
  );
  return withSessions(
    plan,
    plan.sessions.map((candidate) =>
      candidate.id === sessionId ? { ...session, exercises } : candidate,
    ),
  );
}

export interface ScheduledSessionChange {
  readonly sessionId: string;
  readonly scheduledFor?: CalendarDate;
  readonly exercises?: readonly ExercisePrescription[];
}

export function changeScheduledSession(
  plan: Plan,
  change: ScheduledSessionChange,
): Result<ActivePlan, PlanError> {
  if (plan.status !== 'active') return err({ kind: 'plan_not_active', planId: plan.id });
  const session = findScheduledSession(plan, change.sessionId);
  if (!session) return err({ kind: 'session_not_found', sessionId: change.sessionId });
  const changed: ScheduledSession = {
    ...session,
    scheduledFor: change.scheduledFor ?? session.scheduledFor,
    exercises: change.exercises ?? session.exercises,
  };
  return withSessions(
    plan,
    plan.sessions.map((candidate) => (candidate.id === change.sessionId ? changed : candidate)),
  );
}

export function replacePlanSessions(
  plan: Plan,
  sessions: readonly ScheduledSession[],
): Result<ActivePlan, PlanError> {
  return withSessions(plan, sessions);
}

export type ApplyPlanDiffError =
  | PlanError
  | { readonly kind: 'not_a_plan_change'; readonly op: 'correct_completed_session' };

export function applyPlanDiff(plan: Plan, diff: PlanDiff): Result<ActivePlan, ApplyPlanDiffError> {
  switch (diff.op) {
    case 'replace_plan':
      return replacePlanSessions(plan, diff.sessions);
    case 'change_scheduled_session':
      return changeScheduledSession(plan, {
        sessionId: diff.sessionId,
        ...(diff.scheduledFor !== undefined ? { scheduledFor: diff.scheduledFor } : {}),
        ...(diff.exercises !== undefined ? { exercises: diff.exercises } : {}),
      });
    case 'change_exercise_prescription':
      return changeExercisePrescription(plan, diff.sessionId, diff.exerciseId, diff.prescription);
    case 'correct_completed_session':
      return err({ kind: 'not_a_plan_change', op: 'correct_completed_session' });
    default:
      return assertNeverPlanDiff(diff);
  }
}
