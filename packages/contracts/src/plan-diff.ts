import { z } from 'zod';
import { measurementSchema } from './measurement.js';
import { calendarDateSchema, identifierSchema } from './primitives.js';

/**
 * Wire validation for the closed set of proposal operations (R-021, ADR-0002).
 *
 * Mirrors the PlanDiff types in @workout/domain. A test asserts the two agree, so
 * adding an operation to one without the other fails the build rather than
 * silently widening what an agent may post.
 *
 * Every object is `.strict()` and every collection is bounded. An agent sending a
 * field we do not understand is a version mismatch, and a proposal large enough to
 * be unreviewable is not a proposal.
 */

export const PLAN_DIFF_OPERATIONS = [
  'replace_plan',
  'change_scheduled_session',
  'change_exercise_prescription',
  'correct_completed_session',
] as const;

const MAX_SESSIONS_PER_PLAN = 60;
const MAX_EXERCISES_PER_SESSION = 30;
const MAX_CORRECTIONS_PER_PROPOSAL = 100;

export const exercisePrescriptionSchema = z
  .object({
    exerciseId: identifierSchema,
    prescription: measurementSchema,
    /**
     * Whether a unilateral result for this exercise may record its load as a combined total
     * (owner decision 2026-09-18). Absent means no, which is why it is optional rather than
     * defaulted: an agent that omits it is not asking for combined load.
     */
    combinedLoadPermitted: z.boolean().optional(),
  })
  .strict();

export const scheduledSessionSchema = z
  .object({
    id: identifierSchema,
    scheduledFor: calendarDateSchema,
    exercises: z.array(exercisePrescriptionSchema).min(1).max(MAX_EXERCISES_PER_SESSION),
  })
  .strict();

export const setCorrectionSchema = z
  .object({
    setId: identifierSchema,
    measurement: measurementSchema,
  })
  .strict();

export const replacePlanDiffSchema = z
  .object({
    op: z.literal('replace_plan'),
    // An empty plan is a deletion wearing a replacement's clothes; require intent.
    sessions: z.array(scheduledSessionSchema).min(1).max(MAX_SESSIONS_PER_PLAN),
  })
  .strict();

export const changeScheduledSessionDiffSchema = z
  .object({
    op: z.literal('change_scheduled_session'),
    sessionId: identifierSchema,
    scheduledFor: calendarDateSchema.optional(),
    exercises: z.array(exercisePrescriptionSchema).min(1).max(MAX_EXERCISES_PER_SESSION).optional(),
  })
  .strict()
  .refine((diff) => diff.scheduledFor !== undefined || diff.exercises !== undefined, {
    message: 'a change must change something',
  });

export const changeExercisePrescriptionDiffSchema = z
  .object({
    op: z.literal('change_exercise_prescription'),
    sessionId: identifierSchema,
    exerciseId: identifierSchema,
    prescription: measurementSchema,
  })
  .strict();

export const correctCompletedSessionDiffSchema = z
  .object({
    op: z.literal('correct_completed_session'),
    sessionId: identifierSchema,
    corrections: z.array(setCorrectionSchema).min(1).max(MAX_CORRECTIONS_PER_PROPOSAL),
  })
  .strict();

export const planDiffSchema = z.discriminatedUnion('op', [
  replacePlanDiffSchema,
  changeScheduledSessionDiffSchema,
  changeExercisePrescriptionDiffSchema,
  correctCompletedSessionDiffSchema,
]);

export type PlanDiffPayload = z.infer<typeof planDiffSchema>;
