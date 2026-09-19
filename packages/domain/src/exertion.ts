import { err, ok, type Result } from './result.js';

/**
 * Exertion is typed by profile (R-006). A bare `8` is meaningless: it could be
 * RIR, a 1-10 RPE, or a Borg 6-20 rating. Each is a distinct type here.
 */

export type ExertionError =
  | { readonly kind: 'not_finite'; readonly received: number }
  | {
      readonly kind: 'out_of_range';
      readonly received: number;
      readonly min: number;
      readonly max: number;
    }
  | { readonly kind: 'not_half_step'; readonly received: number };

/** Exported for the same reason as the measurement bounds: one copy of each number. */
export const RIR_MIN = 0;
export const RIR_MAX = 10;
export const BORG_MIN = 6;
export const BORG_MAX = 20;

/**
 * Reps in reserve. The authoritative user-entered value for strength sets.
 * Half steps are allowed because the RIR-to-RPE mapping supports them.
 */
export interface RepsInReserve {
  readonly kind: 'rir';
  readonly value: number;
}

/**
 * Derived, read-only. Never user-entered, never stored as an observation.
 * Storing an interpretation as if it were an observation is the error this
 * type exists to prevent (ADR-0004).
 */
export interface DerivedRpe {
  readonly kind: 'rpe_derived';
  readonly value: number;
}

export interface StrengthExertion {
  readonly profile: 'strength';
  readonly rir: RepsInReserve;
  readonly rpe: DerivedRpe;
}

/** Borg 6-20. Tagged separately so it can never share a field with strength exertion. */
export interface CardioExertion {
  readonly profile: 'cardio';
  readonly borg: number;
}

function isHalfStep(value: number): boolean {
  return Number.isInteger(value * 2);
}

export function repsInReserve(value: number): Result<RepsInReserve, ExertionError> {
  if (!Number.isFinite(value)) {
    return err({ kind: 'not_finite', received: value });
  }
  if (value < RIR_MIN || value > RIR_MAX) {
    return err({ kind: 'out_of_range', received: value, min: RIR_MIN, max: RIR_MAX });
  }
  if (!isHalfStep(value)) {
    return err({ kind: 'not_half_step', received: value });
  }
  return ok({ kind: 'rir', value });
}

/**
 * RPE = 10 - RIR, floored at 1.
 *
 * The 1-10 RPE scale bottoms out at 1, while RIR keeps counting upward, so every
 * RIR of 9 or more maps to RPE 1. The mapping is deliberately total and lossy in
 * that direction; RIR remains the stored truth.
 */
export function deriveRpe(rir: RepsInReserve): DerivedRpe {
  return { kind: 'rpe_derived', value: Math.max(1, 10 - rir.value) };
}

export function strengthExertion(rirValue: number): Result<StrengthExertion, ExertionError> {
  const rir = repsInReserve(rirValue);
  if (!rir.ok) {
    return rir;
  }
  return ok({ profile: 'strength', rir: rir.value, rpe: deriveRpe(rir.value) });
}

export function cardioExertion(borg: number): Result<CardioExertion, ExertionError> {
  if (!Number.isFinite(borg)) {
    return err({ kind: 'not_finite', received: borg });
  }
  if (borg < BORG_MIN || borg > BORG_MAX) {
    return err({ kind: 'out_of_range', received: borg, min: BORG_MIN, max: BORG_MAX });
  }
  if (!Number.isInteger(borg)) {
    return err({ kind: 'not_half_step', received: borg });
  }
  return ok({ profile: 'cardio', borg });
}
