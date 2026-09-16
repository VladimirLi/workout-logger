import { z } from 'zod';
import {
  distanceSchema,
  durationSchema,
  loadSemanticsSchema,
  massSchema,
  notesSchema,
  sideSchema,
} from './primitives.js';

/** Mirrors the domain measurement profiles (ADR-0004). Schema-versioned. */
export const MEASUREMENT_SCHEMA_VERSION = 1;

const schemaVersionSchema = z.literal(MEASUREMENT_SCHEMA_VERSION);

/**
 * RPE is DERIVED from RIR: `max(1, 10 - rir)` (ADR-0004). Validating the two
 * independently let a payload assert RIR 2 with RPE 1, a state the domain cannot
 * produce. The refinement below makes the wire contract reject it.
 */
export function deriveRpeValue(rir: number): number {
  return Math.max(1, 10 - rir);
}

const strengthExertionSchema = z
  .object({
    profile: z.literal('strength'),
    rir: z
      .object({
        kind: z.literal('rir'),
        // Half steps only, matching the domain.
        value: z.number().min(0).max(10).multipleOf(0.5),
      })
      .strict(),
    rpe: z.object({ kind: z.literal('rpe_derived'), value: z.number().min(1).max(10) }).strict(),
  })
  .strict()
  .superRefine((exertion, ctx) => {
    const expected = deriveRpeValue(exertion.rir.value);
    if (exertion.rpe.value !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['rpe', 'value'],
        message: `rpe must be the value derived from rir (${expected}), not ${exertion.rpe.value}`,
      });
    }
  });

const cardioExertionSchema = z
  .object({
    profile: z.literal('cardio'),
    borg: z.number().int().min(6).max(20),
  })
  .strict();

export const strengthMeasurementSchema = z
  .object({
    profile: z.literal('strength'),
    schemaVersion: schemaVersionSchema,
    repetitions: z.number().int().positive(),
    load: massSchema.optional(),
    exertion: strengthExertionSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict();

export const unilateralStrengthMeasurementSchema = z
  .object({
    profile: z.literal('unilateral_strength'),
    schemaVersion: schemaVersionSchema,
    side: sideSchema,
    loadSemantics: loadSemanticsSchema,
    repetitions: z.number().int().positive(),
    load: massSchema.optional(),
    exertion: strengthExertionSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict();

export const cardioMeasurementSchema = z
  .object({
    profile: z.literal('cardio'),
    schemaVersion: schemaVersionSchema,
    duration: durationSchema,
    distance: distanceSchema.optional(),
    inclinePercent: z.number().min(-20).max(40).optional(),
    exertion: cardioExertionSchema.optional(),
    notes: notesSchema.optional(),
  })
  .strict();

export const measurementSchema = z.discriminatedUnion('profile', [
  strengthMeasurementSchema,
  unilateralStrengthMeasurementSchema,
  cardioMeasurementSchema,
]);

export type MeasurementPayload = z.infer<typeof measurementSchema>;
