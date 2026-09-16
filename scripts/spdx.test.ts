import { describe, expect, it } from 'vitest';
import { classifySpdx } from './spdx.mjs';

/**
 * The earlier classifier stripped parentheses, split on AND/OR, and then decided
 * "is this a disjunction?" by testing the WHOLE string for the word OR. That made
 * `(MIT OR GPL-3.0-only) AND CC-BY-4.0` classify as allowed, because it saw an OR
 * somewhere and MIT among the terms - even though the AND means every conjunct's
 * obligations apply.
 *
 * The rule now is deliberately unclever: understand a bare id, a pure disjunction,
 * a pure conjunction, and `A WITH B`. Anything else - mixed operators, parentheses,
 * unparseable text - is UNKNOWN, which the policy treats as prohibited. Failing
 * closed on an expression we do not fully understand is the only safe default.
 */

const POLICY = {
  allowed: ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause'],
  rejected: ['AGPL-3.0-only', 'SSPL-1.0'],
  reviewRequired: ['MPL-2.0', 'GPL-3.0-only', 'LGPL-3.0-or-later'],
};

const classify = (expression: string | undefined) => classifySpdx(expression, POLICY);

describe('simple expressions', () => {
  it('accepts a bare allowed id', () => {
    expect(classify('MIT')).toBe('allowed');
  });

  it('rejects a bare prohibited id', () => {
    expect(classify('AGPL-3.0-only')).toBe('rejected');
  });

  it('flags a bare review-required id', () => {
    expect(classify('MPL-2.0')).toBe('review');
  });

  it('treats an unrecognised id as unknown', () => {
    expect(classify('CC-BY-4.0')).toBe('unknown');
  });

  it.each([undefined, '', '   ', 'UNKNOWN', 'Unknown'])('treats %s as unknown', (value) => {
    expect(classify(value)).toBe('unknown');
  });

  it('is case sensitive, because SPDX identifiers are', () => {
    expect(classify('mit')).toBe('unknown');
  });
});

describe('pure disjunction', () => {
  it('is allowed when any disjunct is allowed', () => {
    expect(classify('MIT OR GPL-3.0-only')).toBe('allowed');
    expect(classify('GPL-3.0-only OR MIT')).toBe('allowed');
  });

  it('falls to review when no disjunct is allowed but one needs review', () => {
    expect(classify('MPL-2.0 OR GPL-3.0-only')).toBe('review');
  });

  it('is rejected when every disjunct is prohibited', () => {
    expect(classify('AGPL-3.0-only OR SSPL-1.0')).toBe('rejected');
  });

  it('is still allowed when one disjunct is prohibited and another is allowed', () => {
    // A real choice of licence: we take the permissive one.
    expect(classify('AGPL-3.0-only OR MIT')).toBe('allowed');
  });
});

describe('pure conjunction', () => {
  it('is allowed only when every conjunct is allowed', () => {
    expect(classify('MIT AND ISC')).toBe('allowed');
  });

  it('is rejected when any conjunct is prohibited', () => {
    expect(classify('MIT AND SSPL-1.0')).toBe('rejected');
  });

  it('needs review when a conjunct needs review', () => {
    expect(classify('MIT AND MPL-2.0')).toBe('review');
  });

  it('is unknown when a conjunct is unrecognised', () => {
    expect(classify('MIT AND CC-BY-4.0')).toBe('unknown');
  });
});

describe('redundant outer parentheses', () => {
  /**
   * `(MIT OR CC0-1.0)` is how npm publishes a great many dual licences. Parentheses
   * that wrap the WHOLE expression and contain no nested group carry no grouping
   * information, so refusing them would force pointless exceptions. Anything with
   * internal or partial grouping is still refused.
   */
  it('reads a fully wrapped disjunction as the disjunction', () => {
    expect(classify('(MIT OR GPL-3.0-only)')).toBe('allowed');
  });

  it('reads a fully wrapped conjunction as the conjunction', () => {
    expect(classify('(MIT AND MPL-2.0)')).toBe('review');
  });

  it('reads a fully wrapped bare identifier', () => {
    expect(classify('(MIT)')).toBe('allowed');
  });

  it('still refuses partial grouping', () => {
    expect(classify('MIT AND (ISC OR Apache-2.0)')).toBe('unknown');
  });
});

describe('WITH exceptions', () => {
  it('classifies by the licence, not the exception', () => {
    expect(classify('Apache-2.0 WITH LLVM-exception')).toBe('allowed');
    expect(classify('GPL-3.0-only WITH Classpath-exception-2.0')).toBe('review');
  });

  it('works inside a disjunction', () => {
    expect(classify('Apache-2.0 WITH LLVM-exception OR MIT')).toBe('allowed');
  });
});

describe('expressions the parser does not fully understand fail closed', () => {
  it.each([
    'MIT AND (ISC OR Apache-2.0)',
    '(MIT OR GPL-3.0-only) AND CC-BY-4.0',
    '(MIT) OR (ISC)',
    '((MIT OR ISC))',
    'MIT OR ISC AND Apache-2.0',
    'SEE LICENSE IN LICENSE.md',
    'LicenseRef-Proprietary',
    'MIT AND',
    'OR MIT',
    'MIT OR',
  ])('treats %s as unknown rather than guessing', (expression) => {
    expect(classify(expression)).toBe('unknown');
  });

  it('does not let a permissive disjunct launder a prohibited conjunct', () => {
    // The specific regression: an OR anywhere used to make the whole expression
    // "allowed if any term is allowed", ignoring the AND entirely.
    expect(classify('(MIT OR GPL-3.0-only) AND SSPL-1.0')).not.toBe('allowed');
  });
});
