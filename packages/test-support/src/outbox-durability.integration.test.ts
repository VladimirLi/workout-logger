import {
  classifyDelivery,
  completeWorkout,
  discardWorkout,
  drainOutbox,
  logSet,
  startWorkout,
  type TransportResult,
  type WorkoutTransport,
} from '@workout/application';
import { kilograms, strengthMeasurement, unwrap } from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_USER_ID } from './builders.js';
import { createWorkoutTestPorts } from './in-memory-workout.js';
import { aPlan } from './local-workout-store-cases.js';

/**
 * A queued workout mutation is never discarded automatically (tasks 4.8 and 4.11, ADR-0003,
 * AGENTS.md rule 5).
 *
 * The offline-sync spec names three conditions under which the queue must survive: quota
 * exhaustion, authentication expiry, and a version upgrade. These cover what the application
 * layer decides. The store's own behaviour under a full device is in the contract cases, and
 * survival across an IndexedDB version upgrade is in apps/web/e2e/browser-store.spec.ts,
 * because only a real browser can upgrade a real database.
 *
 * The authentication-expiry condition has no code to exercise yet: there is no authentication
 * (section 3, gates G-2 and G-4). What is proved here is the part that does not depend on it -
 * no delivery outcome, including one that needs a person, removes an entry.
 */

const user = SYNTHETIC_USER_ID;
const T0 = new Date('2026-09-14T10:00:00Z');
const squat = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));

async function aSessionWithOneSet() {
  const ports = createWorkoutTestPorts(T0);
  ports.plans.setActivePlan(user, aPlan());
  const started = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });
  if (!started.ok) throw new Error(`could not start: ${JSON.stringify(started.error)}`);
  const logged = await logSet(ports, {
    userId: user,
    sessionId: started.value.session.id,
    exerciseId: 'back-squat',
    measurement: squat,
  });
  if (!logged.ok) throw new Error(`could not log: ${JSON.stringify(logged.error)}`);
  return { ports, sessionId: started.value.session.id };
}

describe('a full device (task 4.8)', () => {
  it('refuses the new write and keeps every queued mutation', async () => {
    const { ports, sessionId } = await aSessionWithOneSet();
    const before = await ports.store.outbox(user);
    expect(before).toHaveLength(2);

    ports.store.failNextCommitWith('storage_full');
    const refused = await logSet(ports, {
      userId: user,
      sessionId,
      exerciseId: 'back-squat',
      measurement: squat,
    });

    // The write stops, and says why, rather than appearing to succeed.
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toEqual({ kind: 'storage_full' });
    expect(await ports.store.outbox(user)).toEqual(before);
    expect((await ports.store.findSession(user, sessionId))?.sets).toHaveLength(1);
  });

  it('accepts writes again once there is room, without losing the queue', async () => {
    const { ports, sessionId } = await aSessionWithOneSet();
    ports.store.failNextCommitWith('storage_full');
    await logSet(ports, {
      userId: user,
      sessionId,
      exerciseId: 'back-squat',
      measurement: squat,
    });

    const retried = await logSet(ports, {
      userId: user,
      sessionId,
      exerciseId: 'back-squat',
      measurement: squat,
    });
    expect(retried.ok).toBe(true);
    expect(await ports.store.outbox(user)).toHaveLength(3);
  });
});

describe('nothing discards a queued mutation (task 4.11)', () => {
  const transportAlways = (result: TransportResult): WorkoutTransport => ({
    send: () => Promise.resolve(result),
  });

  it('keeps an entry a permanent failure has handed to a person', async () => {
    const { ports } = await aSessionWithOneSet();
    const before = await ports.store.outbox(user);

    const report = await drainOutbox(
      {
        store: ports.store,
        transport: transportAlways({ kind: 'response', status: 422 }),
        clock: ports.clock,
        random: () => 0.5,
      },
      user,
    );

    expect(report.needsAttention).toBeGreaterThan(0);
    const after = await ports.store.outbox(user);
    expect(after.map((entry) => entry.idempotencyKey)).toEqual(
      before.map((entry) => entry.idempotencyKey),
    );
    expect(after.some((entry) => entry.delivery.state === 'needs_attention')).toBe(true);
  });

  it('keeps an entry a retryable failure has only postponed', async () => {
    const { ports } = await aSessionWithOneSet();
    const before = await ports.store.outbox(user);

    await drainOutbox(
      {
        store: ports.store,
        transport: transportAlways({ kind: 'network_error' }),
        clock: ports.clock,
        random: () => 0.5,
      },
      user,
    );

    const after = await ports.store.outbox(user);
    expect(after).toHaveLength(before.length);
    expect(after.some((entry) => entry.delivery.state === 'retrying')).toBe(true);
  });

  it('removes an entry only for a response that accepted it', async () => {
    // The one sanctioned removal, so that "nothing discards" is not proved by a store that
    // cannot remove anything at all.
    const { ports } = await aSessionWithOneSet();
    await drainOutbox(
      {
        store: ports.store,
        transport: transportAlways({ kind: 'response', status: 200 }),
        clock: ports.clock,
        random: () => 0.5,
      },
      user,
    );
    expect(await ports.store.outbox(user)).toEqual([]);
  });

  it('classifies an authentication failure as needing a person, never as a reason to drop', () => {
    // Authentication expiry is one of the three named conditions. The credential path does not
    // exist yet (section 3), but the delivery classification it will report through does: a 401
    // is a 4xx, so the entry is kept and surfaced as needing attention. Nothing in that path
    // removes it.
    const classification = classifyDelivery({ kind: 'response', status: 401 }, T0);
    expect(classification.kind).toBe('permanent');
    expect(classification.kind === 'permanent' && classification.failure).toBe('http_401');
  });
});

describe('discarding a workout (task 5.3)', () => {
  it('refuses without a confirmation, and changes nothing', async () => {
    const { ports, sessionId } = await aSessionWithOneSet();
    const before = await ports.store.outbox(user);

    const refused = await discardWorkout(ports, { userId: user, sessionId, confirmed: false });

    expect(refused.ok === false && refused.error).toEqual({ kind: 'not_confirmed' });
    expect(await ports.store.outbox(user)).toEqual(before);
    expect(await ports.store.findSession(user, sessionId)).toBeDefined();
  });

  it('discards the session and its queue once confirmed', async () => {
    // The one path where a queued mutation goes without the server having accepted it. The
    // spec asks for exactly this, in as many words, behind a confirmation.
    const { ports, sessionId } = await aSessionWithOneSet();
    const discarded = await discardWorkout(ports, { userId: user, sessionId, confirmed: true });

    expect(discarded.ok).toBe(true);
    expect(discarded.ok && discarded.value.discarded.id).toBe(sessionId);
    expect(await ports.store.findSession(user, sessionId)).toBeUndefined();
    expect(await ports.store.outbox(user)).toEqual([]);
  });

  it('refuses to discard a session that is already finished', async () => {
    // A completed session is a recorded fact. It leaves through export and deletion, not here.
    const { ports, sessionId } = await aSessionWithOneSet();
    await completeWorkout(ports, { userId: user, sessionId });

    const refused = await discardWorkout(ports, { userId: user, sessionId, confirmed: true });

    expect(refused.ok === false && refused.error).toEqual({
      kind: 'session_not_active',
      sessionId,
    });
    expect(await ports.store.findSession(user, sessionId)).toBeDefined();
  });

  it('lets the next workout start once the active one is discarded', async () => {
    const { ports, sessionId } = await aSessionWithOneSet();
    const blocked = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });
    expect(blocked.ok === false && blocked.error.kind).toBe('session_already_active');

    await discardWorkout(ports, { userId: user, sessionId, confirmed: true });

    const started = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });
    expect(started.ok).toBe(true);
  });
});
