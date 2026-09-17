import { idempotencyKey } from '@workout/application';
import { describe, expect, it } from 'vitest';
import { cryptoIdempotencyKeys, cryptoIds } from './client-keys.js';

/** Client-generated idempotency keys (offline-sync spec, ADR-0003, task 4.2). */
describe('client idempotency keys', () => {
  it('are random UUIDs, valid as idempotency keys, and never repeat', () => {
    const keys = Array.from({ length: 1_000 }, () => cryptoIdempotencyKeys.next());
    expect(new Set(keys).size).toBe(1_000);
    for (const key of keys) expect(idempotencyKey(key).ok).toBe(true);
  });

  it('come from the platform cryptographic generator, not Math.random', () => {
    const original = Math.random;
    Math.random = () => 0;
    try {
      expect(cryptoIdempotencyKeys.next()).not.toBe(cryptoIdempotencyKeys.next());
    } finally {
      Math.random = original;
    }
  });

  it('also generate session and set ids', () => {
    expect(cryptoIds.next()).not.toBe(cryptoIds.next());
  });
});
