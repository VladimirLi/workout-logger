import { deepStrictEqual, strictEqual } from 'node:assert/strict';
import type {
  IdempotencyKey,
  LocalCommitRequest,
  LocalWorkoutStore,
  PlanReader,
} from '@workout/application';
import {
  activatePlan,
  completeSession,
  deleteSet,
  editSet,
  kilograms,
  type Plan,
  recordSet,
  restoreSet,
  startSession,
  strengthMeasurement,
  unwrap,
  type WorkoutSession,
} from '@workout/domain';
import { SYNTHETIC_USER_ID } from './builders.js';

/**
 * The device store and plan reader contracts, as a list of cases rather than a test file
 * (ADR-0003, ADR-0005).
 *
 * The in-memory reference runs these under Vitest. The IndexedDB adapter runs the SAME list
 * under Playwright, driving a store that lives inside a real browser page, so "the adapter
 * keeps the outbox guarantees" is one suite executed twice rather than two suites that are
 * meant to agree.
 *
 * Assertions come from node:assert instead of a runner's `expect` for that reason: the cases
 * must not know which runner is calling them. Note that `deepStrictEqual` is stricter than
 * `toEqual` was - an implementation that returns an extra `undefined` property now fails,
 * which is the behaviour worth having when the same value crosses a structured-clone boundary.
 */

const user = SYNTHETIC_USER_ID;
const T0 = new Date('2026-09-14T10:00:00Z');
const squat = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));

const key = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as IdempotencyKey;

export function aPlan(id = 'plan-1'): Plan {
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

export function aStartedSession(id: string): WorkoutSession {
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

export interface Case<Harness> {
  readonly name: string;
  run(harness: Harness): Promise<void>;
}

export const LOCAL_WORKOUT_STORE_CASES: readonly Case<LocalWorkoutStoreHarness>[] = [
  {
    name: 'commits a session and its outbox entry together',
    async run({ store }) {
      const session = aStartedSession('workout-1');
      const outcome = await store.commit(startRequest(session, 1));

      deepStrictEqual(outcome, {
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
      deepStrictEqual(await store.findSession(user, 'workout-1'), session);
      deepStrictEqual(await store.activeSession(user), session);
      strictEqual((await store.outbox(user)).length, 1);
    },
  },
  {
    name: 'numbers entries per entity and keeps the outbox in commit order',
    async run({ store }) {
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

      deepStrictEqual(
        (await store.outbox(user)).map((entry) => [entry.entityId, entry.sequence]),
        [
          ['workout-1', 1],
          ['workout-1', 2],
          ['workout-2', 1],
        ],
      );
      strictEqual((await store.findSession(user, 'workout-1'))?.sets.length, 1);
    },
  },
  {
    name: 'continues an entity sequence after earlier entries are acknowledged',
    async run({ store }) {
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
      strictEqual(outcome.kind === 'committed' && outcome.entry.sequence, 2);
    },
  },
  {
    name: 'replays the same key and payload without a duplicate entry',
    async run({ store }) {
      const request = startRequest(aStartedSession('workout-1'), 1);
      const first = await store.commit(request);
      const replay = await store.commit(request);
      deepStrictEqual(replay, first);
      strictEqual((await store.outbox(user)).length, 1);
    },
  },
  {
    name: 'queues an edit, a delete and a restore in order, keeping the tombstone and its dates',
    async run({ store }) {
      const started = aStartedSession('workout-1');
      await store.commit(startRequest(started, 1));
      const logged = unwrap(
        recordSet(started, {
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
      const lighter = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(75)) }));
      const editedAt = new Date('2026-09-14T10:01:00Z');
      const deletedAt = new Date('2026-09-14T10:02:00Z');
      const edited = unwrap(editSet(logged, { setId: 'set-1', measurement: lighter, editedAt }));
      await store.commit({
        userId: user,
        session: edited,
        mutation: {
          kind: 'edit_set',
          sessionId: 'workout-1',
          setId: 'set-1',
          measurement: lighter,
          editedAt,
        },
        idempotencyKey: key(3),
        enqueuedAt: editedAt,
      });
      const deleted = unwrap(deleteSet(edited, 'set-1', deletedAt));
      const deleteRequest: LocalCommitRequest = {
        userId: user,
        session: deleted,
        mutation: { kind: 'delete_set', sessionId: 'workout-1', setId: 'set-1', deletedAt },
        idempotencyKey: key(4),
        enqueuedAt: deletedAt,
      };
      await store.commit(deleteRequest);

      // The tombstone is stored with its dates, and the delete is a queued fact.
      deepStrictEqual(await store.findSession(user, 'workout-1'), deleted);
      // Replaying the delete neither duplicates it nor loses it.
      await store.commit(deleteRequest);
      const restored = unwrap(restoreSet(deleted, 'set-1'));
      await store.commit({
        userId: user,
        session: restored,
        mutation: { kind: 'restore_set', sessionId: 'workout-1', setId: 'set-1' },
        idempotencyKey: key(5),
        enqueuedAt: deletedAt,
      });

      deepStrictEqual(
        (await store.outbox(user)).map((entry) => [entry.sequence, entry.mutation.kind]),
        [
          [1, 'start_session'],
          [2, 'record_set'],
          [3, 'edit_set'],
          [4, 'delete_set'],
          [5, 'restore_set'],
        ],
      );
      deepStrictEqual(await store.findSession(user, 'workout-1'), restored);
    },
  },
  {
    name: 'does not enqueue a delivered change again when it is replayed',
    async run({ store }) {
      const request = startRequest(aStartedSession('workout-1'), 1);
      await store.commit(request);
      await store.acknowledge(user, key(1));
      deepStrictEqual(await store.commit(request), { kind: 'already_delivered' });
      deepStrictEqual(await store.outbox(user), []);
    },
  },
  {
    name: 'refuses a key reused for a different change and writes nothing',
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      const other = aStartedSession('workout-2');
      deepStrictEqual(await store.commit(startRequest(other, 1)), {
        kind: 'idempotency_key_reused',
      });
      strictEqual(await store.findSession(user, 'workout-2'), undefined);
      strictEqual((await store.outbox(user)).length, 1);
    },
  },
  {
    name: 'refuses a reused key even after its entry was acknowledged',
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.acknowledge(user, key(1));
      deepStrictEqual(await store.commit(startRequest(aStartedSession('workout-2'), 1)), {
        kind: 'idempotency_key_reused',
      });
      deepStrictEqual(await store.outbox(user), []);
    },
  },
  {
    name: 'writes neither the session nor the entry when storage is full',
    async run(harness) {
      await harness.store.commit(startRequest(aStartedSession('workout-1'), 1));
      await harness.exhaustStorage();
      deepStrictEqual(await harness.store.commit(startRequest(aStartedSession('workout-2'), 2)), {
        kind: 'storage_full',
      });
      strictEqual(await harness.store.findSession(user, 'workout-2'), undefined);
      deepStrictEqual(
        (await harness.store.outbox(user)).map((entry) => entry.entityId),
        ['workout-1'],
      );
    },
  },
  {
    name: 'updates delivery and acknowledges only the named entry',
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.commit(startRequest(aStartedSession('workout-2'), 2));

      await store.updateDelivery(user, key(1), { state: 'in_flight', attempts: 1 });
      deepStrictEqual(
        (await store.outbox(user)).map((entry) => entry.delivery.state),
        ['in_flight', 'queued'],
      );

      await store.acknowledge(user, key(1));
      deepStrictEqual(
        (await store.outbox(user)).map((entry) => entry.idempotencyKey),
        [key(2)],
      );
    },
  },
  {
    name: 'reports no active session once the session is completed',
    async run({ store }) {
      const session = aStartedSession('workout-1');
      await store.commit(startRequest(session, 1));
      await store.commit({
        userId: user,
        session: unwrap(completeSession(session, T0)),
        mutation: { kind: 'complete_session', sessionId: 'workout-1', completedAt: T0 },
        idempotencyKey: key(2),
        enqueuedAt: T0,
      });
      strictEqual(await store.activeSession(user), undefined);
      strictEqual((await store.findSession(user, 'workout-1'))?.status, 'completed');
    },
  },
  {
    name: 'discards a session and everything queued for it, and nothing else',
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.commit(startRequest(aStartedSession('workout-2'), 2));

      await store.discardSession(user, 'workout-1');

      strictEqual(await store.findSession(user, 'workout-1'), undefined);
      deepStrictEqual(
        (await store.outbox(user)).map((entry) => entry.entityId),
        ['workout-2'],
      );
      // The other session is untouched. (The one-active-session rule belongs to the
      // application, not the store, so committing two directly leaves two active.)
      strictEqual((await store.findSession(user, 'workout-2'))?.id, 'workout-2');
      strictEqual((await store.activeSession(user))?.id, 'workout-2');
    },
  },
  {
    name: 'still refuses a key reused after a discard, because the change was once made',
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.discardSession(user, 'workout-1');
      // Dropping the key record would let a replay of it look like a new change.
      deepStrictEqual(await store.commit(startRequest(aStartedSession('workout-2'), 1)), {
        kind: 'idempotency_key_reused',
      });
    },
  },
  {
    name: 'leaves another user alone when a session is discarded',
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      await store.commit(startRequest(aStartedSession('workout-1'), 2, 'someone-else'));

      await store.discardSession(user, 'workout-1');

      strictEqual((await store.findSession('someone-else', 'workout-1'))?.id, 'workout-1');
      strictEqual((await store.outbox('someone-else')).length, 1);
    },
  },
  {
    name: "keeps one user's sessions and outbox from another",
    async run({ store }) {
      await store.commit(startRequest(aStartedSession('workout-1'), 1));
      deepStrictEqual(await store.outbox('someone-else'), []);
      strictEqual(await store.findSession('someone-else', 'workout-1'), undefined);
      strictEqual(await store.activeSession('someone-else'), undefined);
    },
  },
];

export interface PlanReaderHarness {
  readonly reader: PlanReader;
  seed(userId: string, plan: Plan): void | Promise<void>;
}

export const PLAN_READER_CASES: readonly Case<PlanReaderHarness>[] = [
  {
    name: 'returns nothing before a plan exists',
    async run({ reader }) {
      strictEqual(await reader.activePlan(user), undefined);
    },
  },
  {
    name: 'returns the active plan with its revision',
    async run(harness) {
      const plan = aPlan();
      await harness.seed(user, plan);
      deepStrictEqual(await harness.reader.activePlan(user), plan);
    },
  },
  {
    name: 'never returns a superseded plan as active',
    async run(harness) {
      const { superseded } = unwrap(
        activatePlan(aPlan(), { id: 'plan-2', sessions: [], activatedAt: T0 }),
      );
      if (!superseded) throw new Error('expected a superseded plan');
      await harness.seed(user, superseded);
      strictEqual(await harness.reader.activePlan(user), undefined);
    },
  },
  {
    name: "keeps one user's plan from another",
    async run(harness) {
      await harness.seed(user, aPlan());
      strictEqual(await harness.reader.activePlan('someone-else'), undefined);
    },
  },
];
