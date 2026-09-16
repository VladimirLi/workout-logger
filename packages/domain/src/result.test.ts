import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok, unwrap } from './result.js';

describe('Result', () => {
  it('wraps a success value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('wraps a failure value', () => {
    expect(err('boom')).toEqual({ ok: false, error: 'boom' });
  });

  it('narrows with isOk', () => {
    const result = ok(1);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
  });

  it('narrows with isErr', () => {
    const result = err('boom');
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it('unwraps an Ok', () => {
    expect(unwrap(ok('value'))).toBe('value');
  });

  it('throws when unwrapping an Err, and names the error', () => {
    // unwrap is a test-and-composition-root convenience. Throwing here is correct:
    // the caller asserted the result was Ok and was wrong.
    expect(() => unwrap(err({ kind: 'nope' }))).toThrow(/unwrap called on an Err result/);
    expect(() => unwrap(err({ kind: 'nope' }))).toThrow(/nope/);
  });

  it('treats a falsy success value as a success', () => {
    // A Result that confused `false` or `0` with failure would be worse than useless.
    expect(unwrap(ok(0))).toBe(0);
    expect(unwrap(ok(false))).toBe(false);
    expect(isOk(ok(false))).toBe(true);
  });
});
