import { completeWorkout, logSet, startWorkout } from '@workout/application';
import { activatePlan, kilograms, strengthMeasurement, unwrap } from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_USER_ID } from './builders.js';
import { createWorkoutTestPorts, type WorkoutTestPorts } from './in-memory-workout.js';

/**
 * Start, log, and complete a workout against the in-memory reference ports (task 1.5).
 *
 * Every change lands on the device together with an outbox entry carrying a fresh
 * idempotency key, in order per session (ADR-0003).
 */

const user = SYNTHETIC_USER_ID;
const squat = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));

function portsWithPlan(): WorkoutTestPorts {
  const ports = createWorkoutTestPorts(new Date('2026-09-14T10:00:00Z'));
  const plan = unwrap(
    activatePlan(undefined, {
      id: 'plan-1',
      activatedAt: new Date('2026-09-13T10:00:00Z'),
      sessions: [
        {
          id: 'session-mon',
          scheduledFor: '2026-09-14',
          exercises: [{ exerciseId: 'back-squat', prescription: squat }],
        },
      ],
    }),
  ).activated;
  ports.plans.setActivePlan(user, plan);
  return ports;
}

describe('startWorkout', () => {
  it('stores the new session and its outbox entry together', async () => {
    const ports = portsWithPlan();
    const result = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.session.status).toBe('active');
    expect(await ports.store.activeSession(user)).toEqual(result.value.session);
    const outbox = await ports.store.outbox(user);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      entityId: result.value.session.id,
      sequence: 1,
      mutation: { kind: 'start_session', session: result.value.session },
      delivery: { state: 'queued' },
    });
  });

  it('refuses without an active plan', async () => {
    const ports = createWorkoutTestPorts(new Date('2026-09-14T10:00:00Z'));
    expect(await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' })).toEqual({
      ok: false,
      error: { kind: 'no_active_plan' },
    });
  });

  it('offers the existing session instead of silently starting a second one', async () => {
    const ports = portsWithPlan();
    const first = unwrap(
      await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
    );
    const second = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });
    expect(second).toEqual({
      ok: false,
      error: { kind: 'session_already_active', session: first.session },
    });
    expect(await ports.store.outbox(user)).toHaveLength(1);
  });

  it('passes a domain refusal through and writes nothing', async () => {
    const ports = portsWithPlan();
    expect(await startWorkout(ports, { userId: user, scheduledSessionId: 'missing' })).toEqual({
      ok: false,
      error: { kind: 'scheduled_session_not_found', scheduledSessionId: 'missing' },
    });
    expect(await ports.store.outbox(user)).toEqual([]);
  });

  it('writes nothing and reports it when device storage is full', async () => {
    const ports = portsWithPlan();
    ports.store.failNextCommitWith('storage_full');
    expect(await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' })).toEqual({
      ok: false,
      error: { kind: 'storage_full' },
    });
    expect(await ports.store.activeSession(user)).toBeUndefined();
    expect(await ports.store.outbox(user)).toEqual([]);
  });
});

describe('logSet', () => {
  it('records the set with the current time, ordered after the start, under a new key', async () => {
    const ports = portsWithPlan();
    const { session } = unwrap(
      await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
    );
    ports.clock.set(new Date('2026-09-14T10:03:00Z'));

    const logged = unwrap(
      await logSet(ports, {
        userId: user,
        sessionId: session.id,
        exerciseId: 'back-squat',
        measurement: squat,
      }),
    );

    expect(logged.session.sets).toEqual([
      {
        setId: logged.session.sets[0]?.setId,
        exerciseId: 'back-squat',
        sequence: 1,
        measurement: squat,
        recordedAt: new Date('2026-09-14T10:03:00Z'),
      },
    ]);
    const outbox = await ports.store.outbox(user);
    expect(outbox.map((entry) => [entry.sequence, entry.mutation.kind])).toEqual([
      [1, 'start_session'],
      [2, 'record_set'],
    ]);
    expect(new Set(outbox.map((entry) => entry.idempotencyKey)).size).toBe(2);
  });

  it('refuses an unknown session', async () => {
    const ports = portsWithPlan();
    expect(
      await logSet(ports, {
        userId: user,
        sessionId: 'missing',
        exerciseId: 'back-squat',
        measurement: squat,
      }),
    ).toEqual({ ok: false, error: { kind: 'session_not_found', sessionId: 'missing' } });
  });

  it("does not reach another user's session", async () => {
    const ports = portsWithPlan();
    const { session } = unwrap(
      await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
    );
    expect(
      await logSet(ports, {
        userId: 'someone-else',
        sessionId: session.id,
        exerciseId: 'back-squat',
        measurement: squat,
      }),
    ).toEqual({ ok: false, error: { kind: 'session_not_found', sessionId: session.id } });
  });

  it('keeps the session and outbox unchanged when storage is full', async () => {
    const ports = portsWithPlan();
    const { session } = unwrap(
      await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
    );
    ports.store.failNextCommitWith('storage_full');
    expect(
      await logSet(ports, {
        userId: user,
        sessionId: session.id,
        exerciseId: 'back-squat',
        measurement: squat,
      }),
    ).toEqual({ ok: false, error: { kind: 'storage_full' } });
    expect((await ports.store.activeSession(user))?.sets).toEqual([]);
    expect(await ports.store.outbox(user)).toHaveLength(1);
  });
});

describe('completeWorkout', () => {
  it('completes the session, keeps its sets, and frees the device for a new session', async () => {
    const ports = portsWithPlan();
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
    ports.clock.set(new Date('2026-09-14T10:45:00Z'));

    const completed = unwrap(await completeWorkout(ports, { userId: user, sessionId: session.id }));

    expect(completed.session.status).toBe('completed');
    expect(completed.session.sets).toHaveLength(1);
    expect(await ports.store.activeSession(user)).toBeUndefined();
    expect(await ports.store.findSession(user, session.id)).toEqual(completed.session);
    const outbox = await ports.store.outbox(user);
    expect(outbox.at(-1)?.mutation).toEqual({
      kind: 'complete_session',
      sessionId: session.id,
      completedAt: new Date('2026-09-14T10:45:00Z'),
    });
    expect(outbox.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
  });

  it('refuses to complete a session twice', async () => {
    const ports = portsWithPlan();
    const { session } = unwrap(
      await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
    );
    unwrap(await completeWorkout(ports, { userId: user, sessionId: session.id }));
    expect(await completeWorkout(ports, { userId: user, sessionId: session.id })).toEqual({
      ok: false,
      error: { kind: 'session_not_active', sessionId: session.id },
    });
  });
});
