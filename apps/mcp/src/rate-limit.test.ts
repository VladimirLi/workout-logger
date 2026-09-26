import { describe, expect, it } from 'vitest';
import { InvocationRateLimiter } from './rate-limit.js';

describe('InvocationRateLimiter (task 6.7)', () => {
  it('allows invocations under the cap', () => {
    const limiter = new InvocationRateLimiter({ maxInvocations: 3, windowMs: 60_000 });
    const now = new Date('2026-09-16T12:00:00.000Z');
    expect(limiter.check('client_a', now).ok).toBe(true);
    expect(limiter.check('client_a', now).ok).toBe(true);
    expect(limiter.check('client_a', now).ok).toBe(true);
  });

  it('refuses the next invocation with retry timing', () => {
    const limiter = new InvocationRateLimiter({ maxInvocations: 2, windowMs: 60_000 });
    const now = new Date('2026-09-16T12:00:30.000Z');
    expect(limiter.check('client_a', now).ok).toBe(true);
    expect(limiter.check('client_a', now).ok).toBe(true);
    const refused = limiter.check('client_a', now);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.kind).toBe('rate_limited');
    expect(refused.retryAt.toISOString()).toBe('2026-09-16T12:01:00.000Z');
    expect(refused.retryAfterMs).toBe(30_000);
  });

  it('isolates clients and resets on a new window', () => {
    const limiter = new InvocationRateLimiter({ maxInvocations: 1, windowMs: 60_000 });
    const t0 = new Date('2026-09-16T12:00:00.000Z');
    const t1 = new Date('2026-09-16T12:01:00.000Z');
    expect(limiter.check('client_a', t0).ok).toBe(true);
    expect(limiter.check('client_a', t0).ok).toBe(false);
    expect(limiter.check('client_b', t0).ok).toBe(true);
    expect(limiter.check('client_a', t1).ok).toBe(true);
  });
});
