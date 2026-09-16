import { describe, expect, it } from 'vitest';
import { cardioExertion, deriveRpe, repsInReserve, strengthExertion } from './exertion.js';
import { unwrap } from './result.js';

describe('reps in reserve', () => {
  it('accepts whole steps across the full range', () => {
    for (let value = 0; value <= 10; value += 1) {
      expect(repsInReserve(value).ok).toBe(true);
    }
  });

  it('accepts half steps', () => {
    expect(repsInReserve(2.5).ok).toBe(true);
  });

  it('rejects a quarter step', () => {
    const result = repsInReserve(2.25);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'not_half_step', received: 2.25 });
  });

  it('rejects values outside 0..10', () => {
    expect(repsInReserve(-0.5).ok).toBe(false);
    expect(repsInReserve(10.5).ok).toBe(false);
  });
});

describe('derived RPE', () => {
  it.each([
    [0, 10],
    [1, 9],
    [2.5, 7.5],
    [5, 5],
    [9, 1],
  ])('maps RIR %s to RPE %s', (rir, expected) => {
    expect(deriveRpe(unwrap(repsInReserve(rir))).value).toBe(expected);
  });

  it('floors at RPE 1 because the 1-10 scale bottoms out while RIR keeps counting', () => {
    expect(deriveRpe(unwrap(repsInReserve(10))).value).toBe(1);
    expect(deriveRpe(unwrap(repsInReserve(9.5))).value).toBe(1);
  });

  it('tags the derived value so it can never be mistaken for a user entry', () => {
    const exertion = unwrap(strengthExertion(3));
    expect(exertion.rir.kind).toBe('rir');
    expect(exertion.rpe.kind).toBe('rpe_derived');
    expect(exertion.rir.value).toBe(3);
    expect(exertion.rpe.value).toBe(7);
  });
});

describe('cardio exertion', () => {
  it('accepts the Borg 6..20 range', () => {
    expect(cardioExertion(6).ok).toBe(true);
    expect(cardioExertion(20).ok).toBe(true);
    expect(cardioExertion(13).ok).toBe(true);
  });

  it('rejects values outside the Borg range, including a 1-10 RPE value', () => {
    const result = cardioExertion(5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'out_of_range', received: 5, min: 6, max: 20 });
  });

  it('rejects half steps, which Borg does not define', () => {
    expect(cardioExertion(13.5).ok).toBe(false);
  });

  it('tags cardio exertion distinctly from strength exertion', () => {
    expect(unwrap(cardioExertion(13)).profile).toBe('cardio');
    expect(unwrap(strengthExertion(2)).profile).toBe('strength');
  });
});

describe('exertion input validation', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('rejects %s as RIR', (_label, value) => {
    const result = repsInReserve(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_finite');
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects %s as a Borg rating', (_label, value) => {
    const result = cardioExertion(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_finite');
  });

  it('propagates an invalid RIR out of strengthExertion rather than coercing it', () => {
    const result = strengthExertion(11);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('out_of_range');
  });
});
