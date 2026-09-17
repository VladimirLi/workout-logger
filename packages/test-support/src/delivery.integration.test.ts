import {
  backoffDelayMs,
  classifyDelivery,
  completeWorkout,
  DEFAULT_BACKOFF,
  deliverableEntries,
  drainOutbox,
  logSet,
  type OutboxEntry,
  parseRetryAfterMs,
  startWorkout,
  type TransportResult,
  type WorkoutTransport,
} from '@workout/application';
import {
  activatePlan,
  kilograms,
  startSession,
  strengthMeasurement,
  unwrap,
} from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_USER_ID } from './builders.js';
import { createWorkoutTestPorts } from './in-memory-workout.js';

/**
 * Delivering the outbox (offline-sync spec, ADR-0003): retry classification, capped
 * exponential backoff with full jitter, per-entity ordering, and keys stable across retries.
 */

const user = SYNTHETIC_USER_ID;
const NOW = new Date('2026-09-14T10:00:00Z');
const squat = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));

describe('retry classification (task 4.6)', () => {
  it.each([200, 201, 204])('accepts %i', (status) => {
    expect(classifyDelivery({ kind: 'response', status }, NOW)).toEqual({ kind: 'accepted' });
  });

  it('retries a network error', () => {
    expect(classifyDelivery({ kind: 'network_error' }, NOW)).toEqual({
      kind: 'retry',
      failure: 'network',
    });
  });

  it.each([408, 429, 500, 502, 503, 504])('retries %i', (status) => {
    expect(classifyDelivery({ kind: 'response', status }, NOW)).toMatchObject({
      kind: 'retry',
      failure: `http_${status}`,
    });
  });

  it.each([400, 401, 403, 404, 409, 410, 413, 422])('makes %i a permanent failure', (status) => {
    expect(classifyDelivery({ kind: 'response', status }, NOW)).toEqual({
      kind: 'permanent',
      failure: `http_${status}`,
    });
  });

  it('keeps a Retry-After value with a retryable response', () => {
    expect(classifyDelivery({ kind: 'response', status: 429, retryAfter: '120' }, NOW)).toEqual({
      kind: 'retry',
      failure: 'http_429',
      retryAfterMs: 120_000,
    });
  });
});

describe('Retry-After', () => {
  it('reads delay seconds and HTTP dates, and ignores anything else', () => {
    expect(parseRetryAfterMs('30', NOW)).toBe(30_000);
    expect(parseRetryAfterMs('Mon, 14 Sep 2026 10:02:00 GMT', NOW)).toBe(120_000);
    expect(parseRetryAfterMs('Mon, 14 Sep 2026 09:00:00 GMT', NOW)).toBe(0);
    expect(parseRetryAfterMs('-5', NOW)).toBeUndefined();
    expect(parseRetryAfterMs('soon', NOW)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, NOW)).toBeUndefined();
  });
});

describe('capped exponential backoff with full jitter (task 4.5)', () => {
  const policy = { baseMs: 1_000, capMs: 60_000 };

  it('draws uniformly below an exponentially growing, capped ceiling', () => {
    const top = () => 0.999_999;
    expect(backoffDelayMs({ attempt: 1, random: top, policy })).toBeLessThan(1_000);
    expect(backoffDelayMs({ attempt: 3, random: top, policy })).toBeLessThan(4_000);
    expect(backoffDelayMs({ attempt: 3, random: top, policy })).toBeGreaterThan(3_990);
    expect(backoffDelayMs({ attempt: 20, random: top, policy })).toBeLessThan(60_000);
    expect(backoffDelayMs({ attempt: 20, random: () => 0, policy })).toBe(0);
  });

  it('waits at least a longer Retry-After', () => {
    expect(backoffDelayMs({ attempt: 1, random: () => 0.5, policy, retryAfterMs: 120_000 })).toBe(
      120_000,
    );
  });

  it('keeps the jittered delay when Retry-After is shorter', () => {
    expect(backoffDelayMs({ attempt: 3, random: () => 0.5, policy, retryAfterMs: 10 })).toBe(2_000);
  });

  it('gives simultaneous failures different delays', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const delays = Array.from({ length: 5 }, () => backoffDelayMs({ attempt: 4, random, policy }));
    expect(new Set(delays).size).toBe(5);
  });

  it('uses a documented default policy', () => {
    expect(DEFAULT_BACKOFF).toEqual({ baseMs: 1_000, capMs: 300_000 });
  });
});

function entry(entityId: string, sequence: number, delivery: OutboxEntry['delivery']): OutboxEntry {
  return {
    idempotencyKey:
      `00000000-0000-4000-8000-${entityId.length}${String(sequence).padStart(11, '0')}` as never,
    entityId,
    sequence,
    mutation: { kind: 'complete_session', sessionId: entityId, completedAt: NOW },
    enqueuedAt: NOW,
    delivery,
  };
}

describe('per-entity ordering (task 4.4)', () => {
  it('offers only the earliest entry of each entity', () => {
    const entries = [
      entry('a', 1, { state: 'queued' }),
      entry('a', 2, { state: 'queued' }),
      entry('bb', 1, { state: 'queued' }),
    ];
    expect(deliverableEntries(entries, NOW).map((e) => [e.entityId, e.sequence])).toEqual([
      ['a', 1],
      ['bb', 1],
    ]);
  });

  it('holds an entity whose head is waiting to retry, without holding other entities', () => {
    const waiting = entry('a', 1, {
      state: 'retrying',
      attempts: 1,
      nextAttemptAt: new Date(NOW.getTime() + 5_000),
      lastFailure: 'network',
    });
    const entries = [
      waiting,
      entry('a', 2, { state: 'queued' }),
      entry('bb', 1, { state: 'queued' }),
    ];
    expect(deliverableEntries(entries, NOW).map((e) => e.entityId)).toEqual(['bb']);
    expect(
      deliverableEntries(entries, new Date(NOW.getTime() + 5_000)).map((e) => [
        e.entityId,
        e.sequence,
      ]),
    ).toEqual([
      ['a', 1],
      ['bb', 1],
    ]);
  });

  it('holds an entity behind a permanent failure or an in-flight head', () => {
    const entries = [
      entry('a', 1, { state: 'needs_attention', attempts: 1, lastFailure: 'http_422' }),
      entry('a', 2, { state: 'queued' }),
      entry('bb', 1, { state: 'in_flight', attempts: 1 }),
      entry('bb', 2, { state: 'queued' }),
    ];
    expect(deliverableEntries(entries, NOW)).toEqual([]);
  });

  it('orders entries by sequence even when stored out of order', () => {
    const entries = [entry('a', 2, { state: 'queued' }), entry('a', 1, { state: 'queued' })];
    expect(deliverableEntries(entries, NOW).map((e) => e.sequence)).toEqual([1]);
  });
});

class ScriptedTransport implements WorkoutTransport {
  readonly sent: { key: string; kind: string; sessionId: string }[] = [];
  readonly #script: ((request: Parameters<WorkoutTransport['send']>[0]) => TransportResult)[];

  constructor(script: ((request: Parameters<WorkoutTransport['send']>[0]) => TransportResult)[]) {
    this.#script = script;
  }

  send(request: Parameters<WorkoutTransport['send']>[0]): Promise<TransportResult> {
    const mutation = request.mutation;
    const sessionId = mutation.kind === 'start_session' ? mutation.session.id : mutation.sessionId;
    this.sent.push({ key: request.idempotencyKey, kind: mutation.kind, sessionId });
    const next = this.#script.shift() ?? (() => ({ kind: 'response', status: 200 }) as const);
    return Promise.resolve(next(request));
  }
}

async function queuedWorkout() {
  const ports = createWorkoutTestPorts(NOW);
  ports.plans.setActivePlan(
    user,
    unwrap(
      activatePlan(undefined, {
        id: 'plan-1',
        activatedAt: NOW,
        sessions: [
          {
            id: 'session-mon',
            scheduledFor: '2026-09-14',
            exercises: [{ exerciseId: 'back-squat', prescription: squat }],
          },
        ],
      }),
    ).activated,
  );
  const { session } = unwrap(
    await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
  );
  unwrap(
    await logSet(ports, {
      userId: user,
      sessionId: session.id,
      exerciseId: 'back-squat',
      measurement: squat,
    }),
  );
  unwrap(await completeWorkout(ports, { userId: user, sessionId: session.id }));
  return { ports, session };
}

describe('draining the outbox', () => {
  it('delivers every entry in order and removes each once accepted', async () => {
    const { ports } = await queuedWorkout();
    const transport = new ScriptedTransport([]);
    const report = await drainOutbox({ ...ports, transport, random: () => 0.5 }, user);

    expect(transport.sent.map((sent) => sent.kind)).toEqual([
      'start_session',
      'record_set',
      'complete_session',
    ]);
    expect(report).toEqual({ accepted: 3, retrying: 0, needsAttention: 0 });
    expect(await ports.store.outbox(user)).toEqual([]);
  });

  it('retries with the same idempotency key after a network failure (task 4.2)', async () => {
    const { ports } = await queuedWorkout();
    const transport = new ScriptedTransport([() => ({ kind: 'network_error' })]);
    await drainOutbox({ ...ports, transport, random: () => 0.5 }, user);

    const [head] = await ports.store.outbox(user);
    expect(head?.delivery).toEqual({
      state: 'retrying',
      attempts: 1,
      nextAttemptAt: new Date(NOW.getTime() + 500),
      lastFailure: 'network',
    });
    // The later entries of the same session were not attempted out of order.
    expect(transport.sent.map((sent) => sent.kind)).toEqual(['start_session']);

    ports.clock.set(new Date(NOW.getTime() + 500));
    await drainOutbox({ ...ports, transport, random: () => 0.5 }, user);
    expect(transport.sent[1]?.key).toBe(transport.sent[0]?.key);
    expect(await ports.store.outbox(user)).toEqual([]);
  });

  it('waits for a longer Retry-After before trying again', async () => {
    const { ports } = await queuedWorkout();
    const transport = new ScriptedTransport([
      () => ({ kind: 'response', status: 429, retryAfter: '120' }),
    ]);
    await drainOutbox({ ...ports, transport, random: () => 0.5 }, user);
    const [head] = await ports.store.outbox(user);
    expect(head?.delivery.state === 'retrying' && head.delivery.nextAttemptAt).toEqual(
      new Date(NOW.getTime() + 120_000),
    );

    ports.clock.set(new Date(NOW.getTime() + 119_999));
    await drainOutbox({ ...ports, transport, random: () => 0.5 }, user);
    expect(transport.sent).toHaveLength(1);
  });

  it('keeps a permanently failed entry for the user to decide, and delivers other sessions', async () => {
    const { ports } = await queuedWorkout();
    const plan = await ports.plans.activePlan(user);
    if (!plan) throw new Error('expected a plan');
    const other = unwrap(
      startSession(plan, {
        id: 'other-session',
        scheduledSessionId: 'session-mon',
        startedAt: NOW,
      }),
    );
    expect(
      (
        await ports.store.commit({
          userId: user,
          session: other,
          mutation: { kind: 'start_session', session: other },
          idempotencyKey: ports.keys.next(),
          enqueuedAt: NOW,
        })
      ).kind,
    ).toBe('committed');

    const transport = new ScriptedTransport([() => ({ kind: 'response', status: 422 })]);
    const report = await drainOutbox({ ...ports, transport, random: () => 0.5 }, user);

    const remaining = await ports.store.outbox(user);
    expect(remaining.map((e) => [e.entityId, e.sequence, e.delivery.state])).toEqual([
      ['id-1', 1, 'needs_attention'],
      ['id-1', 2, 'queued'],
      ['id-1', 3, 'queued'],
    ]);
    expect(transport.sent.map((sent) => sent.sessionId)).toEqual(['id-1', 'other-session']);
    expect(report).toEqual({ accepted: 1, retrying: 0, needsAttention: 1 });
  });
});
