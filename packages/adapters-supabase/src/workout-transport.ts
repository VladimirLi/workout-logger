import type { TransportResult, WorkoutTransport } from '@workout/application';
import type { ServerSupabaseConfig } from './config.js';
import {
  PostgrestError,
  PostgrestErrorWithRetry,
  type RestConfig,
  rpcWithHeaders,
} from './rest.js';

/**
 * Delivering a device's queued mutation to the server (offline-sync spec, tasks 2.6 and 4.3).
 *
 * The idempotency key and the mutation reach the database in one call, because they have to
 * commit together: a key recorded for a mutation that never happened, or a mutation a retry
 * applies twice, are the two failures the outbox exists to prevent.
 *
 * The caller is a signed-in user. The database function takes the identity from the token and
 * derives the conflict from the payload it stored, so nothing this class sends decides whether
 * a delivery is a replay.
 *
 * Results are HTTP-shaped because that is what the delivery policy classifies
 * (`classifyDelivery`). A replay is a success, exactly like the first delivery, which is what
 * makes a retry safe. A key reused for a different payload is 409: permanent, needing a person.
 */

/** What the database returns. Checked at runtime, never asserted. */
type ApplyOutcome = 'applied' | 'replayed' | 'key_reused';

function outcomeOf(body: unknown): ApplyOutcome | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const kind = (body as { kind?: unknown }).kind;
  return kind === 'applied' || kind === 'replayed' || kind === 'key_reused' ? kind : undefined;
}

export class SupabaseWorkoutTransport implements WorkoutTransport {
  readonly #rest: RestConfig;

  /**
   * @param accessToken the signed-in user's token. The server reads the identity from it, so
   * there is no user argument to get wrong, and a delivery without one is refused.
   */
  constructor(config: ServerSupabaseConfig, accessToken: string) {
    this.#rest = { url: config.url, key: config.publishableKey, accessToken };
  }

  async send(request: {
    readonly idempotencyKey: string;
    readonly mutation: unknown;
  }): Promise<TransportResult> {
    try {
      const { body, retryAfter } = await rpcWithHeaders<unknown>(
        this.#rest,
        'apply_workout_mutation',
        { p_key: request.idempotencyKey, p_mutation: request.mutation },
      );

      switch (outcomeOf(body)) {
        case 'applied':
        case 'replayed':
          return { kind: 'response', status: 200 };
        case 'key_reused':
          return { kind: 'response', status: 409 };
        default:
          // A 2xx whose body this version does not understand. Reported as a server error so
          // the entry is retried rather than acknowledged: treating it as success would leave
          // the device believing a change was delivered that may never have been applied, and
          // treating it as permanent would strand it as needing attention.
          return {
            kind: 'response',
            status: 502,
            ...(retryAfter ? { retryAfter } : {}),
          };
      }
    } catch (error) {
      if (error instanceof PostgrestErrorWithRetry) {
        // The server said how long to wait; the delivery policy honours it when it is longer
        // than its own backoff.
        return {
          kind: 'response',
          status: error.status,
          ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
        };
      }
      if (error instanceof PostgrestError) {
        return { kind: 'response', status: error.status };
      }
      // No response at all: the network, not the server. The delivery policy retries these.
      return { kind: 'network_error' };
    }
  }
}
