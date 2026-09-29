import { z } from 'zod';
import { measurementSchema } from './measurement.js';
import {
  calendarDateSchema,
  isoTimestamp,
  nameSchema,
  restSecondsSchema,
  revisionSchema,
} from './primitives.js';

/**
 * The full-export document (data-portability spec, tasks 8.1 and 8.2).
 *
 * An export has to be readable by a version of this application that has never seen the device
 * that wrote it, so it declares the schema version it was written against and validates on the
 * way back in. Timestamps are ISO-8601 strings rather than dates, because JSON has no date
 * type and a round trip that silently reinterprets a timestamp is the failure this schema
 * exists to prevent.
 *
 * `strict()` everywhere: an export carrying a field this version does not know about is
 * refused rather than imported with the field dropped, which would lose data quietly.
 */

export const ARCHIVE_SCHEMA_VERSION = 1;

/**
 * The archive reuses the primitives every other contract uses.
 *
 * It used to declare its own: an instant was "any string `Date.parse` accepts", which is not the
 * ISO-8601 instant with an offset its own comment promised - `Date.parse` takes a bare date, a
 * space-separated timestamp and `Sep 18 2026`, and reads a time with no offset in whatever zone
 * the machine is in, so a session moves by hours between the device that exported it and the one
 * that imported it. A date was a bare `YYYY-MM-DD` shape, which accepts 2026-02-30 and turns it
 * into 2 March rather than refusing it.
 *
 * An archive is a file a person can hold and edit, so it is the least trusted input the product
 * has. A second, weaker copy of a rule is exactly where that shows up.
 */
const instantSchema = isoTimestamp;

const exercisePrescriptionSchema = z
  .object({
    exerciseId: z.string().min(1),
    // Optional, unlike a proposal: an export made before names existed has none.
    name: nameSchema.optional(),
    prescription: measurementSchema,
    restSeconds: restSecondsSchema.optional(),
    combinedLoadPermitted: z.boolean().optional(),
  })
  .strict();

const scheduledSessionSchema = z
  .object({
    id: z.string().min(1),
    name: nameSchema.optional(),
    scheduledFor: calendarDateSchema,
    exercises: z.array(exercisePrescriptionSchema),
  })
  .strict();

const planBase = {
  id: z.string().min(1),
  name: nameSchema.optional(),
  revision: revisionSchema,
  sessions: z.array(scheduledSessionSchema),
  activatedAt: instantSchema,
};

export const planSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), ...planBase }).strict(),
  z.object({ status: z.literal('superseded'), ...planBase, supersededAt: instantSchema }).strict(),
]);

const recordedSetSchema = z
  .object({
    setId: z.string().min(1),
    exerciseId: z.string().min(1),
    sequence: z.number().int().positive(),
    measurement: measurementSchema,
    recordedAt: instantSchema,
    editedAt: instantSchema.optional(),
    /** A deleted set is exported as a tombstone, so restoring an export cannot resurrect it. */
    deletedAt: instantSchema.optional(),
  })
  .strict();

const correctionRevisionSchema = z
  .object({
    revision: revisionSchema,
    setId: z.string().min(1),
    previous: measurementSchema,
    corrected: measurementSchema,
    actor: z.object({ kind: z.enum(['user', 'agent']), id: z.string().min(1) }).strict(),
    correctedAt: instantSchema,
  })
  .strict();

const sessionBase = {
  id: z.string().min(1),
  planId: z.string().min(1),
  planRevision: revisionSchema,
  scheduledSessionId: z.string().min(1),
  name: nameSchema.optional(),
  exerciseIds: z.array(z.string().min(1)),
  exerciseNames: z.record(z.string().min(1), nameSchema).optional(),
  /** The exercises that permitted combined load when the session started. */
  combinedLoadExercises: z.array(z.string().min(1)),
  /** The exercises recorded one side at a time when the session started. */
  unilateralExercises: z.array(z.string().min(1)).optional(),
  startedAt: instantSchema,
  sets: z.array(recordedSetSchema),
};

export const sessionSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), ...sessionBase }).strict(),
  z
    .object({
      status: z.literal('completed'),
      ...sessionBase,
      completedAt: instantSchema,
      // Absent until the server has accepted the session; an export made offline has none.
      synchronizedAt: instantSchema.optional(),
      factsRevision: revisionSchema,
      corrections: z.array(correctionRevisionSchema),
    })
    .strict(),
]);

/**
 * Proposals are carried through an export untouched. Their own schema lives with the
 * agent-proposals capability; this keeps the artifact, the diff, and the rationale as written
 * so a rejected proposal is still retrievable a year later (data-portability spec).
 */
const proposalSchema = z.record(z.string(), z.unknown());

export const archiveSchema = z
  .object({
    schemaVersion: z.literal(ARCHIVE_SCHEMA_VERSION),
    exportedAt: instantSchema,
    plans: z.array(planSchema),
    sessions: z.array(sessionSchema),
    proposals: z.array(proposalSchema),
  })
  .strict();

export type ArchivePayload = z.infer<typeof archiveSchema>;
export type ArchivePlanPayload = z.infer<typeof planSchema>;
export type ArchiveSessionPayload = z.infer<typeof sessionSchema>;
