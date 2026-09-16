import { describe, expect, it } from 'vitest';
import { CANONICAL_UNITS, kilograms, metres, quantity, seconds } from './units.js';

describe('canonical units', () => {
  it('pins the canonical storage unit for every dimension', () => {
    expect(CANONICAL_UNITS).toEqual({
      mass: 'kg',
      distance: 'm',
      duration: 's',
      energy: 'kcal',
      power: 'W',
      cadence: 'rpm',
      heartRate: 'bpm',
    });
  });
});

describe('quantity', () => {
  it('carries the unit alongside the value', () => {
    const result = kilograms(42.5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ unit: 'kg', value: 42.5 });
  });

  it('accepts zero, which is a real bodyweight load', () => {
    expect(kilograms(0).ok).toBe(true);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s', (_label, value) => {
    const result = kilograms(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_finite');
  });

  it('rejects a negative value', () => {
    const result = metres(-1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'negative', received: -1 });
  });

  it('rejects a value above the per-unit sanity bound', () => {
    const result = kilograms(1_001);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'above_maximum', received: 1_001, maximum: 1_000 });
  });

  it('applies a different bound per unit', () => {
    expect(seconds(86_400).ok).toBe(true);
    expect(seconds(86_401).ok).toBe(false);
    expect(quantity('bpm', 301).ok).toBe(false);
    expect(quantity('bpm', 180).ok).toBe(true);
  });
});
