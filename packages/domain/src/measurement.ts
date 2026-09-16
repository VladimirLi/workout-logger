import type { CardioExertion, StrengthExertion } from './exertion.js';
import { err, ok, type Result } from './result.js';
import type { Quantity } from './units.js';

/**
 * Discriminated measurement profiles (R-005, ADR-0004).
 *
 * Not one wide nullable row. A bench press set, a split squat set, and twenty
 * minutes on a treadmill are different shapes, and the type says so.
 *
 * SCHEMA_VERSION is bumped by a normal versioned code + migration change
 * (D-014). There is no plugin system and no user-defined schema.
 */
export const MEASUREMENT_SCHEMA_VERSION = 1;

export const MEASUREMENT_PROFILES = ['strength', 'unilateral_strength', 'cardio'] as const;
export type MeasurementProfile = (typeof MEASUREMENT_PROFILES)[number];

/** Which side a unilateral observation belongs to. Never inferred. */
export const SIDES = ['left', 'right', 'both', 'alternating'] as const;
export type Side = (typeof SIDES)[number];

/**
 * Whether a unilateral load value means "this much in each hand" or
 * "this much in total". The default is `per_side` (resolved decision 2), but the
 * record always stores the answer rather than relying on the default.
 */
export const LOAD_SEMANTICS = ['per_side', 'total'] as const;
export type LoadSemantics = (typeof LOAD_SEMANTICS)[number];

export const DEFAULT_UNILATERAL_LOAD_SEMANTICS: LoadSemantics = 'per_side';

interface MeasurementBase {
  readonly schemaVersion: typeof MEASUREMENT_SCHEMA_VERSION;
  readonly notes?: string;
}

export interface StrengthMeasurement extends MeasurementBase {
  readonly profile: 'strength';
  readonly repetitions: number;
  readonly load?: Quantity<'kg'>;
  readonly exertion?: StrengthExertion;
}

export interface UnilateralStrengthMeasurement extends MeasurementBase {
  readonly profile: 'unilateral_strength';
  readonly side: Side;
  readonly loadSemantics: LoadSemantics;
  readonly repetitions: number;
  readonly load?: Quantity<'kg'>;
  readonly exertion?: StrengthExertion;
}

export interface CardioMeasurement extends MeasurementBase {
  readonly profile: 'cardio';
  readonly duration: Quantity<'s'>;
  readonly distance?: Quantity<'m'>;
  readonly inclinePercent?: number;
  readonly exertion?: CardioExertion;
}

export type Measurement = StrengthMeasurement | UnilateralStrengthMeasurement | CardioMeasurement;

export type MeasurementError =
  | { readonly kind: 'repetitions_not_positive_integer'; readonly received: number }
  | { readonly kind: 'incline_out_of_range'; readonly received: number }
  | { readonly kind: 'notes_too_long'; readonly length: number; readonly maximum: number };

const MAX_NOTES_LENGTH = 2_000;
const MAX_INCLINE_PERCENT = 40;
const MIN_INCLINE_PERCENT = -20;

function validateRepetitions(repetitions: number): MeasurementError | undefined {
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    return { kind: 'repetitions_not_positive_integer', received: repetitions };
  }
  return undefined;
}

function validateNotes(notes: string | undefined): MeasurementError | undefined {
  if (notes !== undefined && notes.length > MAX_NOTES_LENGTH) {
    return { kind: 'notes_too_long', length: notes.length, maximum: MAX_NOTES_LENGTH };
  }
  return undefined;
}

export function strengthMeasurement(
  input: Omit<StrengthMeasurement, 'profile' | 'schemaVersion'>,
): Result<StrengthMeasurement, MeasurementError> {
  const problem = validateRepetitions(input.repetitions) ?? validateNotes(input.notes);
  if (problem) {
    return err(problem);
  }
  return ok({ ...input, profile: 'strength', schemaVersion: MEASUREMENT_SCHEMA_VERSION });
}

export function unilateralStrengthMeasurement(
  input: Omit<UnilateralStrengthMeasurement, 'profile' | 'schemaVersion' | 'loadSemantics'> & {
    readonly loadSemantics?: LoadSemantics;
  },
): Result<UnilateralStrengthMeasurement, MeasurementError> {
  const problem = validateRepetitions(input.repetitions) ?? validateNotes(input.notes);
  if (problem) {
    return err(problem);
  }
  return ok({
    ...input,
    loadSemantics: input.loadSemantics ?? DEFAULT_UNILATERAL_LOAD_SEMANTICS,
    profile: 'unilateral_strength',
    schemaVersion: MEASUREMENT_SCHEMA_VERSION,
  });
}

export function cardioMeasurement(
  input: Omit<CardioMeasurement, 'profile' | 'schemaVersion'>,
): Result<CardioMeasurement, MeasurementError> {
  const notesProblem = validateNotes(input.notes);
  if (notesProblem) {
    return err(notesProblem);
  }
  if (
    input.inclinePercent !== undefined &&
    (!Number.isFinite(input.inclinePercent) ||
      input.inclinePercent > MAX_INCLINE_PERCENT ||
      input.inclinePercent < MIN_INCLINE_PERCENT)
  ) {
    return err({ kind: 'incline_out_of_range', received: input.inclinePercent });
  }
  return ok({ ...input, profile: 'cardio', schemaVersion: MEASUREMENT_SCHEMA_VERSION });
}

/**
 * Exhaustiveness helper. Adding a fourth profile without handling it here is a
 * compile error, which is the cheapest place to find out.
 */
export function assertNeverProfile(value: never): never {
  throw new Error(`Unhandled measurement profile: ${JSON.stringify(value)}`);
}
