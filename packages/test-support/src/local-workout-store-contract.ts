import type {
  IdempotencyKey,
  LocalCommitRequest,
  LocalWorkoutStore,
  PlanReader,
} from '@workout/application';
import {
  activatePlan,
  completeSession,
  kilograms,
  type Plan,
  recordSet,
  startSession,
  strengthMeasurement,
  unwrap,
  type WorkoutSession,
} from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_USER_ID } from './builders.js';

/**
 * Contract suites for the device workout store and the plan reader (ADR-0003, ADR-0005).
 *
 * Written against the ports. The in-memory reference and the browser (IndexedDB) adapter run
 * the identical suites, so "the adapter keeps the outbox guarantees" is a command, not a claim.
 */

const user = SYNTHETIC_USER_ID;
const T0 = new Date('2026-09-14T10:00:00Z');
const squat = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));

const key = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as IdempotencyKey;

function aPlan(id = 'plan-1'): Plan {
  return unwrap(
    activatePlan(undefined, {
      id,
      activatedAt: T0,
      sessions: [
        {
          id: 'session-mon',
          scheduledFor: '2026-09-14',
          exercises: [{ exerciseId: 'back-squat', prescription: squat }],
        },
      ],
    }),
  ).activated;
}

function aStartedSession(id: string): WorkoutSession {
  return unwrap(startSession(aPlan(), { id, scheduledSessionId: 'session-mon', startedAt: T0 }));
}

function startRequest(session: WorkoutSession, n: number, userId = user): LocalCommitRequest {
  if (session.status !== 'active') throw new Error('expected an active session');
  return {
    userId,
    session,
    mutation: { kind: 'start_session', session },
    idempotencyKey: key(n),
    enqueuedAt: T0,
  };
}

export interface LocalWorkoutStoreHarness {
  readonly store: LocalWorkoutStore;
  /** Makes the next commit meet a full device. */
  exhaustStorage(): void | Promise<void>;
}

export function localWorkoutStoreContract(
  name: string,
  createHarness: () => Promise<LocalWorkoutStoreHarness> | LocalWorkoutStoreHarness,
): void {
  describe(`LocalWorkoutStore contract: ${name}`, () => {
    it('commits a session and its outbox entry together', async () => {
      const { store } = await createHarness();
      const session = aStartedSession('workout-1');
      const outcome = await store.commit(startRequest(session, 1));

      expect(outcome).toEqual({
        kind: 'committed',
        entry: {
          idempotencyKey: key(1),
          entityId: 'workout-1',
          sequence: 1,
          mutation: { kind: 'start_session', session },
          enqueuedAt: T0,
          delivery: { state: 'queued' },
        },
      });
      expect(await store.findSession(user, 'workout-1')).toEqual(session);
      expect(await store.activeSession(user)).toEqual(session);
      expect(await store.outbox(user)).toHaveLength(1);
    });

    it('numbers entries per entity and keeps the outbox in commit order', async () => {
      const { store } = await createHarness();
      const first = aStartedSession('workout-1');
      await store.commit(startRequest(first, 1));
      const logged = unwrap(
        recordSet(first, {
          setId: 'set-1',
          exerciseId: 'back-squat',
          measurement: squat,
          recordedAt: T0,
        }),
      );
      const set = logged.sets[0];
      if (!set) throw new Error('expected a set');
      await store.commit({
        userId: user,
        session: logged,
        mutation: { kind: 'record_set', sessionId: 'workout-1', set },
        idempotencyKey: key(2),
        enqueuedAt: T0,
      });
      await store.commit(startRequest(aStartedSession('workout-2'), 3));

      expect((await store.outbox(user)).map((entry) => [entry.entityId, entry.sequence])).toEqual([
        ['workout-1', 1],
        ['workout-1', 2],
        ['workout-2', 1],
      ]);
      expect((await store.findSession(user, 'workout-1'))?.sets).toHaveLength(1);
    });

    it('continues an entity sequence after earlier entries are acknowledged', async () => {
      const { store } = await createHarness();
      const session = aStartedSession('workout-1');
      await store.commit(startRequest(session, 1));
      await store.acknowledge(user, key(1));
      const completed = unwrap(completeSession(session, T0));
      const outcome = await store.commit({
        userId: user,
        session: completed,
        mutation: { kind: 'complete_session', sessionId: 'workout-1', completedAt: T0 },
        idempotencyKey: key(2),
        enqueuedAt: T0,
      });
      expect(outcome.kind === 'committed' && outcome.entry.sequence).toBe(2);
    });

    it('replays the same key and payload without a duplicate entry', async () => {
      const { store } = await createHarness();
      const request = startRequest(aStartedSession('workout-1'), 1);
      const first = await store.commit(request);
      const replay = await store.commit(request);
      expect(replay).toEqual(first);
      expect(await store.outbox(user)).toHaveLength(1);
    });

    it('does not enqueue a delivered change again when it is replayed', async () => {
      const { store } = await createHarness();
      const request = startRequest(aStartedSession('workout-1'), 1);
      await store.commit(request);
      await store.acknowledge(user, key(1));
      expect(await store.commit(request)).toEqual({ kind: 'already_delivered' });
      expect(await store.outbox(user)).toEqual([]);
    });

    it('refuses a key reused for a different change and writes nothing', async () => {
      const { store } = await createHarness();
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      const other = aStartedSession('workout-2');
      expect(await store.commit(startRequest(other, 1))).toEqual({
        kind: 'idempotency_key_reused',
      });
      expect(await store.findSession(user, 'workout-2')).toBeUndefined();
      expect(await store.outbox(user)).toHaveLength(1);
    });

    it('refuses a reused key even after its entry was acknowledged', async () => {
      const { store } = await createHarness();
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.acknowledge(user, key(1));
      expect(await store.commit(startRequest(aStartedSession('workout-2'), 1))).toEqual({
        kind: 'idempotency_key_reused',
      });
      expect(await store.outbox(user)).toEqual([]);
    });

    it('writes neither the session nor the entry when storage is full', async () => {
      const harness = await createHarness();
      await harness.store.commit(startRequest(aStartedSession('workout-1'), 1));
      await harness.exhaustStorage();
      expect(await harness.store.commit(startRequest(aStartedSession('workout-2'), 2))).toEqual({
        kind: 'storage_full',
      });
      expect(await harness.store.findSession(user, 'workout-2')).toBeUndefined();
      expect((await harness.store.outbox(user)).map((entry) => entry.entityId)).toEqual([
        'workout-1',
      ]);
    });

    it('updates delivery and acknowledges only the named entry', async () => {
      const { store } = await createHarness();
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.commit(startRequest(aStartedSession('workout-2'), 2));

      await store.updateDelivery(user, key(1), { state: 'in_flight', attempts: 1 });
      expect((await store.outbox(user)).map((entry) => entry.delivery.state)).toEqual([
        'in_flight',
        'queued',
      ]);

      await store.acknowledge(user, key(1));
      expect((await store.outbox(user)).map((entry) => entry.idempotencyKey)).toEqual([key(2)]);
    });

    it('reports no active session once the session is completed', async () => {
      const { store } = await createHarness();
      const session = aStartedSession('workout-1');
      await store.commit(startRequest(session, 1));
      await store.commit({
        userId: user,
        session: unwrap(completeSession(session, T0)),
        mutation: { kind: 'complete_session', sessionId: 'workout-1', completedAt: T0 },
        idempotencyKey: key(2),
        enqueuedAt: T0,
      });
      expect(await store.activeSession(user)).toBeUndefined();
      expect((await store.findSession(user, 'workout-1'))?.status).toBe('completed');
    });

    it("keeps one user's sessions and outbox from another", async () => {
      const { store } = await createHarness();
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      expect(await store.outbox('someone-else')).toEqual([]);
      expect(await store.findSession('someone-else', 'workout-1')).toBeUndefined();
      expect(await store.activeSession('someone-else')).toBeUndefined();
    });
  });
}

export interface PlanReaderHarness {
  readonly reader: PlanReader;
  seed(userId: string, plan: Plan): void | Promise<void>;
}

export function planReaderContract(
  name: string,
  createHarness: () => Promise<PlanReaderHarness> | PlanReaderHarness,
): void {
  describe(`PlanReader contract: ${name}`, () => {
    it('returns nothing before a plan exists', async () => {
      const { reader } = await createHarness();
      expect(await reader.activePlan(user)).toBeUndefined();
    });

    it('returns the active plan with its revision', async () => {
      const harness = await createHarness();
      const plan = aPlan();
      await harness.seed(user, plan);
      expect(await harness.reader.activePlan(user)).toEqual(plan);
    });

    it('never returns a superseded plan as active', async () => {
      const harness = await createHarness();
      const { superseded } = unwrap(
        activatePlan(aPlan(), { id: 'plan-2', sessions: [], activatedAt: T0 }),
      );
      if (!superseded) throw new Error('expected a superseded plan');
      await harness.seed(user, superseded);
      expect(await harness.reader.activePlan(user)).toBeUndefined();
    });

    it("keeps one user's plan from another", async () => {
      const harness = await createHarness();
      await harness.seed(user, aPlan());
      expect(await harness.reader.activePlan('someone-else')).toBeUndefined();
    });
  });
}
