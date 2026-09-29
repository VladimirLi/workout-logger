import {
  completeWorkout,
  deleteRecordedSet,
  editRecordedSet,
  logSet,
  restoreRecordedSet,
  startWorkout,
} from '@workout/application';
import { activatePlan, kilograms, liveSets, strengthMeasurement, unwrap } from '@workout/domain';
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

describe('editing, deleting and restoring a recorded set', () => {
  const lighter = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(75)) }));

  async function withTwoSets() {
    const ports = portsWithPlan();
    const { session } = unwrap(
      await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' }),
    );
    for (const _ of [1, 2]) {
      unwrap(
        await logSet(ports, {
          userId: user,
          sessionId: session.id,
          exerciseId: 'back-squat',
          measurement: squat,
        }),
      );
    }
    const sets = (await ports.store.activeSession(user))?.sets ?? [];
    return {
      ports,
      sessionId: session.id,
      first: sets[0]?.setId ?? '',
      second: sets[1]?.setId ?? '',
    };
  }

  it('edits a set in place and queues it as its own change', async () => {
    const { ports, sessionId, first } = await withTwoSets();
    ports.clock.set(new Date('2026-09-14T10:20:00Z'));

    const edited = unwrap(
      await editRecordedSet(ports, { userId: user, sessionId, setId: first, measurement: lighter }),
    );

    expect(liveSets(edited.session)[0]).toMatchObject({
      setId: first,
      sequence: 1,
      measurement: lighter,
      editedAt: new Date('2026-09-14T10:20:00Z'),
    });
    const last = (await ports.store.outbox(user)).at(-1);
    expect(last?.mutation).toEqual({
      kind: 'edit_set',
      sessionId,
      setId: first,
      measurement: lighter,
      editedAt: new Date('2026-09-14T10:20:00Z'),
    });
  });

  it('deletes with a tombstone, so the queued delete is a fact and not a vanished row', async () => {
    const { ports, sessionId, first } = await withTwoSets();

    const deleted = unwrap(
      await deleteRecordedSet(ports, { userId: user, sessionId, setId: first }),
    );

    expect(liveSets(deleted.session).map((set) => set.setId)).not.toContain(first);
    expect(deleted.session.sets.find((set) => set.setId === first)?.deletedAt).toBeInstanceOf(Date);
    const outbox = await ports.store.outbox(user);
    expect(outbox.map((entry) => entry.mutation.kind)).toEqual([
      'start_session',
      'record_set',
      'record_set',
      'delete_set',
    ]);
    // The queued record_set the delete refers to is still there, in order, undiscarded.
    expect(outbox.filter((entry) => entry.mutation.kind === 'record_set')).toHaveLength(2);
  });

  it('restores a deleted set to its value and position, as a later queued change', async () => {
    const { ports, sessionId, first, second } = await withTwoSets();
    unwrap(await deleteRecordedSet(ports, { userId: user, sessionId, setId: first }));

    const restored = unwrap(
      await restoreRecordedSet(ports, { userId: user, sessionId, setId: first }),
    );

    expect(liveSets(restored.session).map((set) => [set.setId, set.sequence])).toEqual([
      [first, 1],
      [second, 2],
    ]);
    expect((await ports.store.outbox(user)).map((entry) => entry.mutation.kind).slice(-2)).toEqual([
      'delete_set',
      'restore_set',
    ]);
  });

  it('refuses to restore a set that was never deleted, and writes nothing', async () => {
    const { ports, sessionId, first } = await withTwoSets();
    const before = await ports.store.outbox(user);

    const refused = await restoreRecordedSet(ports, { userId: user, sessionId, setId: first });

    expect(refused).toEqual({ ok: false, error: { kind: 'set_not_deleted', setId: first } });
    expect(await ports.store.outbox(user)).toEqual(before);
  });

  it('refuses to edit a deleted set or an unknown one, and writes nothing', async () => {
    const { ports, sessionId, first } = await withTwoSets();
    unwrap(await deleteRecordedSet(ports, { userId: user, sessionId, setId: first }));
    const before = await ports.store.outbox(user);

    expect(
      await editRecordedSet(ports, { userId: user, sessionId, setId: first, measurement: lighter }),
    ).toEqual({ ok: false, error: { kind: 'set_deleted', setId: first } });
    expect(
      await editRecordedSet(ports, {
        userId: user,
        sessionId,
        setId: 'nope',
        measurement: lighter,
      }),
    ).toEqual({ ok: false, error: { kind: 'set_not_found', setId: 'nope' } });
    expect(await ports.store.outbox(user)).toEqual(before);
  });

  it('refuses once the session is completed', async () => {
    const { ports, sessionId, first } = await withTwoSets();
    unwrap(await completeWorkout(ports, { userId: user, sessionId }));

    const refused = await deleteRecordedSet(ports, { userId: user, sessionId, setId: first });

    expect(refused.ok).toBe(false);
  });

  it('keeps the session and outbox unchanged when storage is full', async () => {
    const { ports, sessionId, first } = await withTwoSets();
    const before = await ports.store.outbox(user);
    ports.store.failNextCommitWith('storage_full');

    expect(await deleteRecordedSet(ports, { userId: user, sessionId, setId: first })).toEqual({
      ok: false,
      error: { kind: 'storage_full' },
    });
    expect(liveSets((await ports.store.activeSession(user))!)).toHaveLength(2);
    expect(await ports.store.outbox(user)).toEqual(before);
  });
});
