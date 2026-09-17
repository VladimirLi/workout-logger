import { describe, expect, it } from 'vitest';
import { formatMessage } from './icu';

describe('ICU message subset', () => {
  it('substitutes arguments and formats numbers', () => {
    expect(formatMessage('Set {index} of {total}', { index: 2, total: 4 })).toBe('Set 2 of 4');
  });

  it('selects CLDR plural categories', () => {
    const pattern = '{count, plural, one {# set} other {# sets}}';
    expect(formatMessage(pattern, { count: 1 })).toBe('1 set');
    expect(formatMessage(pattern, { count: 16 })).toBe('16 sets');
    expect(formatMessage(pattern, { count: 1200 })).toBe('1,200 sets');
  });

  it('prefers an exact match', () => {
    expect(
      formatMessage('{count, plural, =0 {No sets} one {# set} other {# sets}}', { count: 0 }),
    ).toBe('No sets');
  });

  it('follows the locale plural rules', () => {
    const pattern = '{n, plural, one {one} few {few} many {many} other {other}}';
    expect(formatMessage(pattern, { n: 3 }, 'pl')).toBe('few');
    expect(formatMessage(pattern, { n: 5 }, 'pl')).toBe('many');
  });

  it('fails loudly on anything outside the subset', () => {
    expect(() => formatMessage('{who, select, a {A} other {B}}', { who: 'a' })).toThrow(
      /unsupported/,
    );
    expect(() => formatMessage('{count, plural, one {# set}}', { count: 1 })).toThrow(
      /unsupported/,
    );
    expect(() => formatMessage('Set {index}', {})).toThrow(/missing value/);
    expect(() => formatMessage('Set {index', { index: 1 })).toThrow(/unbalanced/);
  });
});
