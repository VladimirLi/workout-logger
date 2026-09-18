import type { TransportResult, WorkoutTransport } from '@workout/application';
import type { ServerSupabaseConfig } from './config.js';
import { PostgrestError, type RestConfig, rpc } from './rest.js';

/**
 * Delivering a device's queued mutation to the server (offline-sync spec, tasks 2.6 and 4.3).
 *
 * The idempotency key and the mutation reach the database in one call, because they have to
 * commit together: a key recorded for a mutation that never happened, or a mutation a retry
 * applies twice, are the two failures the outbox exists to prevent.
 *
 * The transport reports HTTP-shaped results because that is what the delivery policy in the
 * application layer classifies (`classifyDelivery`). A replay is a success, exactly like the
 * first delivery, which is what makes a retry safe. A key reused for a different payload is
 * 409: a permanent failure needing a person, never a retry.
 */

export interface MutationFingerprint {
  /** A digest of the mutation, computed by the caller. Compared, never recomputed here. */
  (mutation: unknown): string;
}

export class SupabaseWorkoutTransport implements WorkoutTransport {
  readonly #rest: RestConfig;
  readonly #userId: string;
  readonly #fingerprint: MutationFingerprint;

  constructor(
    config: ServerSupabaseConfig,
    userId: string,
    fingerprint: MutationFingerprint,
    accessToken?: string,
  ) {
    this.#rest = {
      url: config.url,
      key: config.serviceRoleKey,
      ...(accessToken ? { accessToken } : {}),
    };
    this.#userId = userId;
    this.#fingerprint = fingerprint;
  }

  async send(request: {
    readonly idempotencyKey: string;
    readonly mutation: unknown;
  }): Promise<TransportResult> {
    try {
      const outcome = await rpc<{ kind: 'applied' | 'replayed' | 'key_reused' }>(
        this.#rest,
        'apply_workout_mutation',
        {
          p_user_id: this.#userId,
          p_key: request.idempotencyKey,
          p_fingerprint: this.#fingerprint(request.mutation),
          p_mutation: request.mutation,
        },
      );

      switch (outcome.kind) {
        case 'applied':
        case 'replayed':
          // A replay is a success. The server already holds this change, which is precisely
          // what the client wanted, so the entry leaves the queue.
          return { kind: 'response', status: 200 };
        case 'key_reused':
          return { kind: 'response', status: 409 };
      }
    } catch (error) {
      if (error instanceof PostgrestError) {
        return { kind: 'response', status: error.status };
      }
      // No response at all: the network, not the server. The delivery policy retries these.
      return { kind: 'network_error' };
    }
  }
}
