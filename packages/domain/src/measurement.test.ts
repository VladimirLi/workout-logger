import { describe, expect, it } from 'vitest';
import { strengthExertion } from './exertion.js';
import {
  assertNeverProfile,
  cardioMeasurement,
  DEFAULT_UNILATERAL_LOAD_SEMANTICS,
  MEASUREMENT_PROFILES,
  MEASUREMENT_SCHEMA_VERSION,
  type Measurement,
  strengthMeasurement,
  unilateralStrengthMeasurement,
} from './measurement.js';
import { unwrap } from './result.js';
import { kilograms, metres, seconds } from './units.js';

describe('measurement profiles', () => {
  it('pins the first-slice profile set', () => {
    expect(MEASUREMENT_PROFILES).toEqual(['strength', 'unilateral_strength', 'cardio']);
  });

  it('stamps every measurement with the schema version', () => {
    const strength = unwrap(strengthMeasurement({ repetitions: 5 }));
    expect(strength.schemaVersion).toBe(MEASUREMENT_SCHEMA_VERSION);
  });
});

describe('strength measurement', () => {
  it('stores load as a typed quantity, not a bare number', () => {
    const result = unwrap(strengthMeasurement({ repetitions: 5, load: unwrap(kilograms(100)) }));
    expect(result.load).toEqual({ unit: 'kg', value: 100 });
  });

  it('carries RIR as entered and RPE as derived', () => {
    const result = unwrap(
      strengthMeasurement({ repetitions: 8, exertion: unwrap(strengthExertion(2)) }),
    );
    expect(result.exertion?.rir.value).toBe(2);
    expect(result.exertion?.rpe.value).toBe(8);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects %s repetitions', (repetitions) => {
    const result = strengthMeasurement({ repetitions });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('repetitions_not_positive_integer');
  });

  it('rejects notes beyond the length bound', () => {
    const result = strengthMeasurement({ repetitions: 5, notes: 'x'.repeat(2_001) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'notes_too_long', length: 2_001, maximum: 2_000 });
  });
});

describe('unilateral strength measurement', () => {
  it('defaults load semantics to per_side', () => {
    const result = unwrap(unilateralStrengthMeasurement({ side: 'left', repetitions: 10 }));
    expect(result.loadSemantics).toBe('per_side');
    expect(DEFAULT_UNILATERAL_LOAD_SEMANTICS).toBe('per_side');
  });

  it('stores the semantics explicitly even when they match the default', () => {
    const result = unwrap(unilateralStrengthMeasurement({ side: 'right', repetitions: 10 }));
    expect(Object.hasOwn(result, 'loadSemantics')).toBe(true);
  });

  it('honours an explicit total override', () => {
    const result = unwrap(
      unilateralStrengthMeasurement({ side: 'both', repetitions: 10, loadSemantics: 'total' }),
    );
    expect(result.loadSemantics).toBe('total');
  });

  it('keeps left and right as distinct records rather than averaging them', () => {
    const left = unwrap(
      unilateralStrengthMeasurement({ side: 'left', repetitions: 10, load: unwrap(kilograms(20)) }),
    );
    const right = unwrap(
      unilateralStrengthMeasurement({ side: 'right', repetitions: 8, load: unwrap(kilograms(18)) }),
    );

    expect(left.side).toBe('left');
    expect(right.side).toBe('right');
    expect(left.repetitions).not.toBe(right.repetitions);
    expect(left.load).not.toEqual(right.load);
  });
});

describe('cardio measurement', () => {
  it('requires a typed duration', () => {
    const result = unwrap(cardioMeasurement({ duration: unwrap(seconds(1_200)) }));
    expect(result.duration).toEqual({ unit: 's', value: 1_200 });
  });

  it('stores distance in canonical metres', () => {
    const result = unwrap(
      cardioMeasurement({ duration: unwrap(seconds(1_200)), distance: unwrap(metres(4_000)) }),
    );
    expect(result.distance).toEqual({ unit: 'm', value: 4_000 });
  });

  it('accepts a negative incline for decline work', () => {
    expect(cardioMeasurement({ duration: unwrap(seconds(600)), inclinePercent: -3 }).ok).toBe(true);
  });

  it('rejects an implausible incline', () => {
    const result = cardioMeasurement({ duration: unwrap(seconds(600)), inclinePercent: 41 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'incline_out_of_range', received: 41 });
  });
});

describe('exhaustiveness', () => {
  it('handles every profile in a switch without falling through', () => {
    const measurements: Measurement[] = [
      unwrap(strengthMeasurement({ repetitions: 5 })),
      unwrap(unilateralStrengthMeasurement({ side: 'alternating', repetitions: 6 })),
      unwrap(cardioMeasurement({ duration: unwrap(seconds(300)) })),
    ];

    const labels = measurements.map((measurement) => {
      switch (measurement.profile) {
        case 'strength':
          return 'strength';
        case 'unilateral_strength':
          return measurement.side;
        case 'cardio':
          return `${measurement.duration.value}s`;
        default:
          return assertNeverProfile(measurement);
      }
    });

    expect(labels).toEqual(['strength', 'alternating', '300s']);
  });
});

describe('validation coverage across profiles', () => {
  it('rejects over-long notes on a unilateral measurement', () => {
    const result = unilateralStrengthMeasurement({
      side: 'left',
      repetitions: 5,
      notes: 'x'.repeat(2_001),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('notes_too_long');
  });

  it('rejects invalid repetitions on a unilateral measurement', () => {
    const result = unilateralStrengthMeasurement({ side: 'left', repetitions: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('repetitions_not_positive_integer');
  });

  it('rejects over-long notes on a cardio measurement', () => {
    const result = cardioMeasurement({
      duration: unwrap(seconds(600)),
      notes: 'x'.repeat(2_001),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('notes_too_long');
  });

  it('rejects a non-finite incline', () => {
    const result = cardioMeasurement({
      duration: unwrap(seconds(600)),
      inclinePercent: Number.NaN,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('incline_out_of_range');
  });

  it('rejects an incline below the decline bound', () => {
    const result = cardioMeasurement({
      duration: unwrap(seconds(600)),
      inclinePercent: -21,
    });
    expect(result.ok).toBe(false);
  });

  it('accepts notes at exactly the length bound', () => {
    expect(strengthMeasurement({ repetitions: 5, notes: 'x'.repeat(2_000) }).ok).toBe(true);
  });

  it('throws from the exhaustiveness guard if an unhandled profile ever reaches it', () => {
    // Reachable only if a profile is added without updating a switch. The guard exists
    // so that mistake fails loudly at runtime as well as at compile time.
    expect(() => assertNeverProfile({ profile: 'rowing' } as never)).toThrow(
      /Unhandled measurement profile/,
    );
  });
});
