import { err, ok, type Result } from './result.js';

/**
 * Canonical storage units (R-005). Every stored quantity carries one of these.
 * Display conversion happens at the edge and never overwrites the canonical value.
 */
export const CANONICAL_UNITS = {
  mass: 'kg',
  distance: 'm',
  duration: 's',
  energy: 'kcal',
  power: 'W',
  cadence: 'rpm',
  heartRate: 'bpm',
} as const;

export type Dimension = keyof typeof CANONICAL_UNITS;
export type Unit = (typeof CANONICAL_UNITS)[Dimension];

/**
 * A number with a unit. There is no constructor that produces a bare number,
 * which is the point: `load: 40` is not representable.
 */
export interface Quantity<U extends Unit = Unit> {
  readonly unit: U;
  readonly value: number;
}

export type QuantityError =
  | { readonly kind: 'not_finite'; readonly received: number }
  | { readonly kind: 'negative'; readonly received: number }
  | { readonly kind: 'above_maximum'; readonly received: number; readonly maximum: number };

/** Loose upper bounds. They catch unit mistakes and fat fingers, not world records. */
const MAXIMUM_BY_UNIT: Readonly<Record<Unit, number>> = {
  kg: 1_000,
  m: 1_000_000,
  s: 86_400,
  kcal: 100_000,
  W: 5_000,
  rpm: 300,
  bpm: 300,
};

export function quantity<U extends Unit>(
  unit: U,
  value: number,
): Result<Quantity<U>, QuantityError> {
  if (!Number.isFinite(value)) {
    return err({ kind: 'not_finite', received: value });
  }
  if (value < 0) {
    return err({ kind: 'negative', received: value });
  }
  const maximum = MAXIMUM_BY_UNIT[unit];
  if (value > maximum) {
    return err({ kind: 'above_maximum', received: value, maximum });
  }
  return ok({ unit, value });
}

export const kilograms = (value: number): Result<Quantity<'kg'>, QuantityError> =>
  quantity('kg', value);
export const metres = (value: number): Result<Quantity<'m'>, QuantityError> => quantity('m', value);
export const seconds = (value: number): Result<Quantity<'s'>, QuantityError> =>
  quantity('s', value);
