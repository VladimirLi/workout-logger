import { deriveSyncState, idempotencyKey, type OutboxEntry } from '@workout/application';
import { unwrap } from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SequentialIdempotencyKeys } from './in-memory-workout.js';

/**
 * Offline ports (offline-sync spec, ADR-0003): idempotency keys and the three sync states.
 */

const KEY = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

function entry(delivery: OutboxEntry['delivery'], sequence = 1): OutboxEntry {
  return {
    idempotencyKey: unwrap(idempotencyKey(KEY.replace(/.$/, String(sequence)))),
    entityId: 'workout-1',
    sequence,
    mutation: { kind: 'complete_session', sessionId: 'workout-1', completedAt: new Date(0) },
    enqueuedAt: new Date(0),
    delivery,
  };
}

describe('idempotency keys', () => {
  it('accepts a UUID', () => {
    expect(unwrap(idempotencyKey(KEY))).toBe(KEY);
  });

  it.each(['', 'set-1', '3f2b8c1e9a4d4e6f8b7a1c2d3e4f5a6b', `${KEY} `])('refuses %j', (value) => {
    expect(idempotencyKey(value)).toEqual({
      ok: false,
      error: { kind: 'not_a_uuid', received: value },
    });
  });

  it('the reference generator produces distinct valid keys', () => {
    const generator = new SequentialIdempotencyKeys();
    const keys = new Set(Array.from({ length: 100 }, () => generator.next()));
    expect(keys.size).toBe(100);
    for (const key of keys) expect(idempotencyKey(key).ok).toBe(true);
  });
});

describe('the three sync states', () => {
  it('reports nothing when no mutation is pending for the entity', () => {
    expect(deriveSyncState([])).toBeUndefined();
  });

  it('reports saved on device for a mutation recorded and not yet attempted', () => {
    expect(deriveSyncState([entry({ state: 'queued' })])).toBe('saved_on_device');
  });

  it('reports syncing while a delivery is in flight or waiting to retry', () => {
    expect(deriveSyncState([entry({ state: 'in_flight', attempts: 1 })])).toBe('syncing');
    expect(
      deriveSyncState([
        entry({
          state: 'retrying',
          attempts: 2,
          nextAttemptAt: new Date(5_000),
          lastFailure: 'network',
        }),
      ]),
    ).toBe('syncing');
  });

  it('reports needs attention for a permanent failure, whatever else is pending', () => {
    expect(
      deriveSyncState([
        entry({ state: 'queued' }, 2),
        entry({ state: 'needs_attention', attempts: 1, lastFailure: 'http_422' }, 1),
        entry({ state: 'in_flight', attempts: 1 }, 3),
      ]),
    ).toBe('needs_attention');
  });

  it('never reports more than the three states', () => {
    const states = new Set(
      [
        [entry({ state: 'queued' })],
        [entry({ state: 'in_flight', attempts: 1 })],
        [entry({ state: 'needs_attention', attempts: 1, lastFailure: 'http_400' })],
      ].map(deriveSyncState),
    );
    expect([...states].sort()).toEqual(['needs_attention', 'saved_on_device', 'syncing']);
  });
});
