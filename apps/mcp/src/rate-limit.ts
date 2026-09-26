export const DEFAULT_MAX_INVOCATIONS_PER_WINDOW = 60;
export const DEFAULT_WINDOW_MS = 60_000;

export type RateLimitDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: 'rate_limited';
      readonly retryAfterMs: number;
      readonly retryAt: Date;
    };

export interface RateLimiterOptions {
  readonly maxInvocations: number;
  readonly windowMs: number;
}

export class InvocationRateLimiter {
  readonly #max: number;
  readonly #windowMs: number;
  readonly #buckets = new Map<string, { readonly windowStart: number; count: number }>();

  constructor(
    options: RateLimiterOptions = {
      maxInvocations: DEFAULT_MAX_INVOCATIONS_PER_WINDOW,
      windowMs: DEFAULT_WINDOW_MS,
    },
  ) {
    this.#max = options.maxInvocations;
    this.#windowMs = options.windowMs;
  }

  check(clientId: string, now: Date): RateLimitDecision {
    const nowMs = now.getTime();
    const windowStart = Math.floor(nowMs / this.#windowMs) * this.#windowMs;
    const existing = this.#buckets.get(clientId);
    if (!existing || existing.windowStart !== windowStart) {
      this.#buckets.set(clientId, { windowStart, count: 1 });
      return { ok: true };
    }
    if (existing.count >= this.#max) {
      const retryAt = new Date(windowStart + this.#windowMs);
      return {
        ok: false,
        kind: 'rate_limited',
        retryAfterMs: retryAt.getTime() - nowMs,
        retryAt,
      };
    }
    existing.count += 1;
    return { ok: true };
  }
}
