import { describe, expect, it } from 'vitest';
import {
  cardioMeasurementSchema,
  measurementSchema,
  strengthMeasurementSchema,
} from './measurement.js';

/**
 * The wire schemas previously reused one unrestricted quantity schema for every
 * field, so `load: { unit: 's', value: 5 }` and `duration: { unit: 'kg', value: 1 }`
 * both parsed. They also validated RIR and RPE independently, so a payload could
 * claim RIR 2 with RPE 1 - a contradiction the domain cannot produce, since RPE is
 * derived from RIR (ADR-0004).
 *
 * A wire contract that accepts states the domain cannot represent is not a
 * contract.
 */

const STRENGTH = { profile: 'strength', schemaVersion: 1, repetitions: 5 } as const;

describe('dimensional correctness', () => {
  it('accepts a load in kilograms', () => {
    const result = strengthMeasurementSchema.safeParse({
      ...STRENGTH,
      load: { unit: 'kg', value: 92.5 },
    });
    expect(result.success).toBe(true);
  });

  it.each(['s', 'm', 'bpm', 'W', 'rpm', 'kcal'])('rejects a load expressed in %s', (unit) => {
    const result = strengthMeasurementSchema.safeParse({
      ...STRENGTH,
      load: { unit, value: 5 },
    });
    expect(result.success).toBe(false);
  });

  it('requires cardio duration to be seconds', () => {
    expect(
      cardioMeasurementSchema.safeParse({
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 'kg', value: 1_200 },
      }).success,
    ).toBe(false);

    expect(
      cardioMeasurementSchema.safeParse({
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 1_200 },
      }).success,
    ).toBe(true);
  });

  it('requires cardio distance to be metres', () => {
    const base = { profile: 'cardio', schemaVersion: 1, duration: { unit: 's', value: 1_200 } };
    expect(
      cardioMeasurementSchema.safeParse({ ...base, distance: { unit: 'kg', value: 4_000 } })
        .success,
    ).toBe(false);
    expect(
      cardioMeasurementSchema.safeParse({ ...base, distance: { unit: 'm', value: 4_000 } }).success,
    ).toBe(true);
  });

  it('enforces the same per-unit bounds the domain enforces', () => {
    expect(
      strengthMeasurementSchema.safeParse({ ...STRENGTH, load: { unit: 'kg', value: 1_001 } })
        .success,
    ).toBe(false);
    expect(
      cardioMeasurementSchema.safeParse({
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 86_401 },
      }).success,
    ).toBe(false);
  });
});

describe('derived RPE must agree with RIR', () => {
  function withExertion(rir: number, rpe: number) {
    return strengthMeasurementSchema.safeParse({
      ...STRENGTH,
      exertion: {
        profile: 'strength',
        rir: { kind: 'rir', value: rir },
        rpe: { kind: 'rpe_derived', value: rpe },
      },
    });
  }

  it.each([
    [0, 10],
    [2, 8],
    [2.5, 7.5],
    [5, 5],
    [9, 1],
    [10, 1],
  ])('accepts RIR %s with its derived RPE %s', (rir, rpe) => {
    expect(withExertion(rir, rpe).success).toBe(true);
  });

  it('rejects an RPE that does not follow from the RIR', () => {
    expect(withExertion(2, 1).success).toBe(false);
    expect(withExertion(0, 5).success).toBe(false);
    expect(withExertion(9, 2).success).toBe(false);
  });

  it('rejects a quarter-step RIR, matching the domain', () => {
    expect(withExertion(2.25, 7.75).success).toBe(false);
  });

  it('rejects an RIR outside 0..10', () => {
    expect(withExertion(11, 1).success).toBe(false);
    expect(withExertion(-1, 11).success).toBe(false);
  });
});

describe('profile-specific fields stay on their profile', () => {
  it('rejects an incline on a strength measurement', () => {
    expect(measurementSchema.safeParse({ ...STRENGTH, inclinePercent: 5 }).success).toBe(false);
  });

  it('rejects repetitions on a cardio measurement', () => {
    expect(
      measurementSchema.safeParse({
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 600 },
        repetitions: 5,
      }).success,
    ).toBe(false);
  });
});
