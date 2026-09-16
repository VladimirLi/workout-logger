import { describe, expect, it } from 'vitest';
import { calendarDateSchema } from './primitives.js';

/**
 * `Date.parse('2026-02-30T00:00:00Z')` is not a reliable validity check. Engines
 * differ on out-of-range components, some clamp and some roll over, and a value that
 * round-trips to a DIFFERENT day is worse than one that is rejected: the session
 * silently moves.
 *
 * So the date is parsed by exact components and then round-tripped through UTC. If
 * the reconstructed year, month and day are not the ones written down, the value is
 * refused.
 */

const accepts = (value: string) => calendarDateSchema.safeParse(value).success;

describe('well-formed dates', () => {
  it.each(['2026-01-01', '2026-09-20', '2026-12-31', '2000-02-29', '2024-02-29'])(
    'accepts %s',
    (value) => {
      expect(accepts(value)).toBe(true);
    },
  );

  it('preserves the exact day it was given', () => {
    expect(calendarDateSchema.parse('2026-09-20')).toBe('2026-09-20');
  });
});

describe('days that do not exist are refused, not rolled over', () => {
  it.each([
    '2026-02-30',
    '2026-02-29',
    '2025-02-29',
    '2100-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-06-31',
    '2026-09-31',
    '2026-11-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-01-32',
  ])('rejects %s', (value) => {
    expect(accepts(value)).toBe(false);
  });

  it('rejects the classic rollover case rather than silently moving the session', () => {
    // A rolling parser turns this into 2026-03-02. A workout scheduled for a day that
    // does not exist must fail loudly, not land on a different day.
    expect(accepts('2026-02-30')).toBe(false);
  });
});

describe('leap years', () => {
  it('accepts 29 February in a leap year', () => {
    expect(accepts('2024-02-29')).toBe(true);
  });

  it('accepts 29 February in a century leap year divisible by 400', () => {
    expect(accepts('2000-02-29')).toBe(true);
  });

  it('rejects 29 February in a century year not divisible by 400', () => {
    expect(accepts('1900-02-29')).toBe(false);
    expect(accepts('2100-02-29')).toBe(false);
  });

  it('rejects 29 February in an ordinary year', () => {
    expect(accepts('2026-02-29')).toBe(false);
  });
});

describe('shape', () => {
  it.each([
    '2026-9-20',
    '26-09-20',
    '2026/09/20',
    '2026-09-20T00:00:00Z',
    '2026-09-20 ',
    ' 2026-09-20',
    'next tuesday',
    '',
    '20260920',
    '+2026-09-20',
  ])('rejects %s', (value) => {
    expect(accepts(value)).toBe(false);
  });

  it('rejects a non-string', () => {
    expect(calendarDateSchema.safeParse(20260920).success).toBe(false);
    expect(calendarDateSchema.safeParse(new Date()).success).toBe(false);
  });
});

describe('bounds', () => {
  it('rejects a year before the product could plausibly have data', () => {
    expect(accepts('1969-07-20')).toBe(false);
  });

  it('rejects a year absurdly far in the future', () => {
    expect(accepts('9999-01-01')).toBe(false);
  });

  it('accepts the declared bounds themselves', () => {
    expect(accepts('2000-01-01')).toBe(true);
    expect(accepts('2999-12-31')).toBe(true);
  });
});
