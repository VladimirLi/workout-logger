import { describe, expect, it } from 'vitest';
import { unwrap } from './result.js';
import { nextRevision, revision, sameRevision } from './revision.js';

describe('revision', () => {
  it('accepts a positive integer', () => {
    expect(unwrap(revision(1))).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (value) => {
    const result = revision(value);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_positive_integer');
  });

  it('advances monotonically', () => {
    expect(nextRevision(unwrap(revision(7)))).toBe(8);
  });

  it('compares by equality only', () => {
    const a = unwrap(revision(3));
    expect(sameRevision(a, unwrap(revision(3)))).toBe(true);
    expect(sameRevision(a, unwrap(revision(4)))).toBe(false);
  });
});
