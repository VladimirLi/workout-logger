import { describe, expect, it } from 'vitest';
import {
  correctSet,
  currentMeasurement,
  markSynchronized,
  measurementHistory,
  originalMeasurement,
} from './correction.js';
import type { CorrectionActor } from './correction-revision.js';
import { cardioMeasurement, strengthMeasurement } from './measurement.js';
import { activatePlan } from './plan.js';
import { unwrap } from './result.js';
import { revision } from './revision.js';
import { type CompletedSession, completeSession, recordSet, startSession } from './session.js';
import { kilograms, seconds } from './units.js';

/**
 * Completed-session immutability (workout-logging spec, D-012).
 *
 * Once synchronized, recorded facts never change in place. A correction is an audited revision
 * that names who made it and when, and the original value stays retrievable.
 */

const T0 = new Date('2026-09-14T10:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const load = (kg: number) =>
  unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(kg)) }));
const user: CorrectionActor = { kind: 'user', id: 'user-1' };

function synchronizedSession(): CompletedSession {
  const plan = unwrap(
    activatePlan(undefined, {
      id: 'plan-1',
      activatedAt: at(-60),
      sessions: [
        {
          id: 'session-mon',
          scheduledFor: '2026-09-14',
          exercises: [{ exerciseId: 'back-squat', prescription: load(80) }],
        },
      ],
    }),
  ).activated;
  const started = unwrap(
    startSession(plan, { id: 'workout-1', scheduledSessionId: 'session-mon', startedAt: T0 }),
  );
  const logged = unwrap(
    recordSet(started, {
      setId: 'set-1',
      exerciseId: 'back-squat',
      measurement: load(80),
      recordedAt: at(5),
    }),
  );
  return unwrap(markSynchronized(unwrap(completeSession(logged, at(40))), at(41)));
}

describe('synchronization', () => {
  it('records when a completed session was synchronized and starts its facts at revision 1', () => {
    const session = synchronizedSession();
    expect(session.synchronizedAt).toEqual(at(41));
    expect(session.factsRevision).toBe(unwrap(revision(1)));
    expect(session.corrections).toEqual([]);
  });

  it('refuses to synchronize twice', () => {
    expect(markSynchronized(synchronizedSession(), at(50))).toEqual({
      ok: false,
      error: { kind: 'already_synchronized', sessionId: 'workout-1' },
    });
  });
});

describe('correcting a synchronized result', () => {
  it('creates an audited revision and keeps the original value retrievable', () => {
    const session = synchronizedSession();
    const corrected = unwrap(
      correctSet(session, {
        setId: 'set-1',
        measurement: load(82.5),
        actor: user,
        correctedAt: at(60),
      }),
    );

    expect(corrected.factsRevision).toBe(unwrap(revision(2)));
    expect(corrected.corrections).toEqual([
      {
        revision: unwrap(revision(2)),
        setId: 'set-1',
        previous: load(80),
        corrected: load(82.5),
        actor: user,
        correctedAt: at(60),
      },
    ]);
    expect(originalMeasurement(corrected, 'set-1')).toEqual(load(80));
    expect(currentMeasurement(corrected, 'set-1')).toEqual(load(82.5));
    // The recorded fact itself is never rewritten.
    expect(corrected.sets[0]?.measurement).toEqual(load(80));
  });

  it('records the actor and the time of each correction, and keeps every version in order', () => {
    const agent: CorrectionActor = { kind: 'agent', id: 'proposal-7' };
    const once = unwrap(
      correctSet(synchronizedSession(), {
        setId: 'set-1',
        measurement: load(82.5),
        actor: user,
        correctedAt: at(60),
      }),
    );
    const twice = unwrap(
      correctSet(once, {
        setId: 'set-1',
        measurement: load(85),
        actor: agent,
        correctedAt: at(90),
      }),
    );
    expect(twice.factsRevision).toBe(unwrap(revision(3)));
    expect(
      twice.corrections.map(({ actor, correctedAt, previous }) => ({
        actor,
        correctedAt,
        previous,
      })),
    ).toEqual([
      { actor: user, correctedAt: at(60), previous: load(80) },
      { actor: agent, correctedAt: at(90), previous: load(82.5) },
    ]);
    expect(measurementHistory(twice, 'set-1')).toEqual([load(80), load(82.5), load(85)]);
    // The earlier value object is untouched.
    expect(once.factsRevision).toBe(unwrap(revision(2)));
  });

  it('refuses a correction to a set the session does not have', () => {
    expect(
      correctSet(synchronizedSession(), {
        setId: 'set-9',
        measurement: load(80),
        actor: user,
        correctedAt: at(60),
      }),
    ).toEqual({ ok: false, error: { kind: 'set_not_found', setId: 'set-9' } });
    expect(originalMeasurement(synchronizedSession(), 'set-9')).toBeUndefined();
    expect(currentMeasurement(synchronizedSession(), 'set-9')).toBeUndefined();
    expect(measurementHistory(synchronizedSession(), 'set-9')).toEqual([]);
  });

  it('refuses a correction that changes the measurement profile', () => {
    const cardio = unwrap(cardioMeasurement({ duration: unwrap(seconds(600)) }));
    expect(
      correctSet(synchronizedSession(), {
        setId: 'set-1',
        measurement: cardio,
        actor: user,
        correctedAt: at(60),
      }),
    ).toEqual({
      ok: false,
      error: { kind: 'profile_changed', setId: 'set-1', from: 'strength', to: 'cardio' },
    });
  });

  it('refuses a correction that changes nothing, so no empty revision is recorded', () => {
    expect(
      correctSet(synchronizedSession(), {
        setId: 'set-1',
        measurement: load(80),
        actor: user,
        correctedAt: at(60),
      }),
    ).toEqual({ ok: false, error: { kind: 'correction_unchanged', setId: 'set-1' } });
  });

  it('refuses a bare value as a correction', () => {
    expect(
      correctSet(synchronizedSession(), {
        setId: 'set-1',
        // @ts-expect-error a bare number is not a measurement
        measurement: 82.5,
        actor: user,
        correctedAt: at(60),
      }),
    ).toEqual({ ok: false, error: { kind: 'not_a_measurement', setId: 'set-1' } });
  });

  it('refuses a correction dated before the session was synchronized', () => {
    expect(
      correctSet(synchronizedSession(), {
        setId: 'set-1',
        measurement: load(85),
        actor: user,
        correctedAt: at(30),
      }),
    ).toEqual({ ok: false, error: { kind: 'corrected_before_synchronization', setId: 'set-1' } });
  });

  it('refuses a correction to a completed session that has not been synchronized', () => {
    const plan = unwrap(
      activatePlan(undefined, {
        id: 'plan-1',
        activatedAt: at(-60),
        sessions: [
          {
            id: 'session-mon',
            scheduledFor: '2026-09-14',
            exercises: [{ exerciseId: 'back-squat', prescription: load(80) }],
          },
        ],
      }),
    ).activated;
    const started = unwrap(
      startSession(plan, { id: 'workout-2', scheduledSessionId: 'session-mon', startedAt: T0 }),
    );
    const completed = unwrap(completeSession(started, at(40)));
    expect(
      correctSet(completed, {
        setId: 'set-1',
        measurement: load(85),
        actor: user,
        correctedAt: at(60),
      }),
    ).toEqual({ ok: false, error: { kind: 'not_synchronized', sessionId: 'workout-2' } });
  });
});
