import {
  completeWorkout,
  DELETION_RECOVERY_DAYS,
  logSet,
  purgeExpiredDeletion,
  recoverDeletion,
  scheduleRecoverableDeletion,
  startWorkout,
} from '@workout/application';
import {
  cardioMeasurement,
  kilograms,
  seconds,
  strengthMeasurement,
  unilateralStrengthMeasurement,
  unwrap,
} from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_USER_ID } from './builders.js';
import { InMemoryDeletionStore } from './in-memory-deletion.js';
import { FixedClock } from './in-memory-ports.js';
import { createWorkoutTestPorts } from './in-memory-workout.js';
import { aPlan } from './local-workout-store-cases.js';

const user = SYNTHETIC_USER_ID;
const T0 = new Date('2026-09-14T10:00:00Z');

async function aDeviceWithHistory(at: Date) {
  const ports = createWorkoutTestPorts(at);
  await ports.store.putPlan(user, aPlan());
  ports.plans.setActivePlan(user, aPlan());

  const started = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });
  if (!started.ok) throw new Error('could not start the session');
  const sessionId = started.value.session.id;

  const squat = unwrap(
    strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)), exertion: undefined }),
  );
  const splitSquat = unwrap(
    unilateralStrengthMeasurement({
      repetitions: 10,
      side: 'left',
      loadSemantics: 'per_side',
      load: unwrap(kilograms(22.5)),
    }),
  );
  const treadmill = unwrap(
    cardioMeasurement({
      duration: unwrap(seconds(1_200)),
      inclinePercent: 2.5,
      notes: 'easy',
    }),
  );

  for (const measurement of [squat, splitSquat, treadmill]) {
    const logged = await logSet(ports, {
      userId: user,
      sessionId,
      exerciseId: 'back-squat',
      measurement,
    });
    if (!logged.ok) throw new Error(`could not log: ${JSON.stringify(logged.error)}`);
  }

  const completed = await completeWorkout(ports, { userId: user, sessionId });
  if (!completed.ok) throw new Error(`could not complete: ${JSON.stringify(completed.error)}`);
  const deletions = new InMemoryDeletionStore();
  return { ports, sessionId, deletions };
}

describe('recoverable deletion (tasks 8.3 and 8.4)', () => {
  it('clears live data and keeps a recoverable copy for 30 days', async () => {
    const { ports, sessionId, deletions } = await aDeviceWithHistory(T0);
    const scheduled = await scheduleRecoverableDeletion(
      {
        source: ports.store,
        sink: ports.store,
        eraser: ports.store,
        deletions,
        clock: ports.clock,
      },
      user,
    );
    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) throw new Error('schedule failed');
    expect(scheduled.value.recoverableUntil.toISOString()).toBe(
      new Date(T0.getTime() + DELETION_RECOVERY_DAYS * 24 * 60 * 60 * 1_000).toISOString(),
    );
    expect(await ports.store.sessions(user)).toEqual([]);
    expect(await ports.store.plans(user)).toEqual([]);
    expect((await deletions.get(user))?.archive.sessions.map((s) => s.id)).toEqual([sessionId]);
  });

  it('restores everything when recovery happens inside the window', async () => {
    const { ports, sessionId, deletions } = await aDeviceWithHistory(T0);
    const deletionPorts = {
      source: ports.store,
      sink: ports.store,
      eraser: ports.store,
      deletions,
      clock: ports.clock,
    };
    const scheduled = await scheduleRecoverableDeletion(deletionPorts, user);
    expect(scheduled.ok).toBe(true);

    const midWindow = new FixedClock(
      new Date(T0.getTime() + (DELETION_RECOVERY_DAYS - 1) * 24 * 60 * 60 * 1_000),
    );
    const recovered = await recoverDeletion({ ...deletionPorts, clock: midWindow }, user);
    expect(recovered.ok).toBe(true);
    expect((await ports.store.sessions(user)).map((s) => s.id)).toEqual([sessionId]);
    expect((await ports.store.plans(user)).map((p) => p.id)).toEqual(['plan-1']);
    expect(await deletions.get(user)).toBeUndefined();
  });

  it('refuses recovery after the window and hard-deletes with verification', async () => {
    const { ports, deletions } = await aDeviceWithHistory(T0);
    const deletionPorts = {
      source: ports.store,
      sink: ports.store,
      eraser: ports.store,
      deletions,
      clock: ports.clock,
    };
    expect((await scheduleRecoverableDeletion(deletionPorts, user)).ok).toBe(true);

    const afterWindow = new FixedClock(
      new Date(T0.getTime() + DELETION_RECOVERY_DAYS * 24 * 60 * 60 * 1_000),
    );
    const refused = await recoverDeletion({ ...deletionPorts, clock: afterWindow }, user);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error.kind).toBe('recovery_expired');

    const purged = await purgeExpiredDeletion({ ...deletionPorts, clock: afterWindow }, user);
    expect(purged.ok).toBe(true);
    expect(purged.ok && purged.value.verifiedGone).toBe(true);
    expect(await deletions.get(user)).toBeUndefined();
    expect(await ports.store.sessions(user)).toEqual([]);
    expect(await ports.store.plans(user)).toEqual([]);
  });

  it('refuses a second deletion while one is pending', async () => {
    const { ports, deletions } = await aDeviceWithHistory(T0);
    const deletionPorts = {
      source: ports.store,
      sink: ports.store,
      eraser: ports.store,
      deletions,
      clock: ports.clock,
    };
    expect((await scheduleRecoverableDeletion(deletionPorts, user)).ok).toBe(true);
    const second = await scheduleRecoverableDeletion(deletionPorts, user);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error.kind).toBe('already_pending');
  });

  it('refuses to purge while the recovery window is still open', async () => {
    const { ports, deletions } = await aDeviceWithHistory(T0);
    const deletionPorts = {
      source: ports.store,
      sink: ports.store,
      eraser: ports.store,
      deletions,
      clock: ports.clock,
    };
    expect((await scheduleRecoverableDeletion(deletionPorts, user)).ok).toBe(true);
    const purged = await purgeExpiredDeletion(deletionPorts, user);
    expect(purged.ok).toBe(false);
    expect(purged.ok === false && purged.error.kind).toBe('still_recoverable');
    expect(await deletions.get(user)).toBeDefined();
  });

  it('removes the pending copy when erase fails so the device is not stranded', async () => {
    const { ports, deletions } = await aDeviceWithHistory(T0);
    const deletionPorts = {
      source: ports.store,
      sink: ports.store,
      eraser: {
        clearAll: async () => {
          throw new Error('disk full');
        },
      },
      deletions,
      clock: ports.clock,
    };
    const scheduled = await scheduleRecoverableDeletion(deletionPorts, user);
    expect(scheduled.ok).toBe(false);
    expect(scheduled.ok === false && scheduled.error.kind).toBe('erase_failed');
    expect(await deletions.get(user)).toBeUndefined();
    expect((await ports.store.sessions(user)).length).toBeGreaterThan(0);
    expect((await ports.store.plans(user)).length).toBeGreaterThan(0);

    const retry = await scheduleRecoverableDeletion(
      {
        source: ports.store,
        sink: ports.store,
        eraser: ports.store,
        deletions,
        clock: ports.clock,
      },
      user,
    );
    expect(retry.ok).toBe(true);
  });
});
