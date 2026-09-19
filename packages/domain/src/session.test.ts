import { describe, expect, it } from 'vitest';
import { strengthExertion } from './exertion.js';
import {
  cardioMeasurement,
  strengthMeasurement,
  unilateralStrengthMeasurement,
} from './measurement.js';
import { activatePlan } from './plan.js';
import { unwrap } from './result.js';
import { completeSession, recordSet, startSession, type WorkoutSession } from './session.js';
import { kilograms, seconds } from './units.js';

/**
 * The workout session (workout-logging spec, R-005, ADR-0004).
 *
 * A session follows one scheduled session of the active plan and records what actually
 * happened as typed measurements. There is no path that records a bare number.
 */

const STARTED_AT = new Date('2026-09-14T10:00:00Z');
const squatTarget = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));
const lungeTarget = unwrap(
  unilateralStrengthMeasurement({ side: 'left', repetitions: 10, load: unwrap(kilograms(12)) }),
);

const plan = unwrap(
  activatePlan(undefined, {
    id: 'plan-1',
    activatedAt: new Date('2026-09-13T10:00:00Z'),
    sessions: [
      {
        id: 'session-mon',
        scheduledFor: '2026-09-14',
        exercises: [
          { exerciseId: 'back-squat', prescription: squatTarget },
          { exerciseId: 'split-squat', prescription: lungeTarget },
        ],
      },
    ],
  }),
).activated;

function started(): WorkoutSession {
  return unwrap(
    startSession(plan, {
      id: 'workout-1',
      scheduledSessionId: 'session-mon',
      startedAt: STARTED_AT,
    }),
  );
}

const at = (minutes: number) => new Date(STARTED_AT.getTime() + minutes * 60_000);

describe('starting a session', () => {
  it('follows a scheduled session of the active plan and records its revision', () => {
    const session = started();
    expect(session).toEqual({
      id: 'workout-1',
      planId: 'plan-1',
      planRevision: plan.revision,
      scheduledSessionId: 'session-mon',
      exerciseIds: ['back-squat', 'split-squat'],
      // Snapshotted at start; none of these exercises permits combined load.
      combinedLoadExercises: [],
      status: 'active',
      startedAt: STARTED_AT,
      sets: [],
    });
  });

  it('refuses a scheduled session the plan does not have', () => {
    expect(
      startSession(plan, { id: 'workout-1', scheduledSessionId: 'missing', startedAt: STARTED_AT }),
    ).toEqual({
      ok: false,
      error: { kind: 'scheduled_session_not_found', scheduledSessionId: 'missing' },
    });
  });

  it('refuses to start from a plan that is no longer active', () => {
    const { superseded } = unwrap(
      activatePlan(plan, { id: 'plan-2', sessions: [], activatedAt: STARTED_AT }),
    );
    if (!superseded) throw new Error('expected a superseded plan');
    expect(
      startSession(superseded, {
        id: 'workout-1',
        scheduledSessionId: 'session-mon',
        startedAt: STARTED_AT,
      }),
    ).toEqual({ ok: false, error: { kind: 'plan_not_active', planId: 'plan-1' } });
  });
});

describe('recording results', () => {
  it('records a strength set as a typed measurement, with RIR as entered', () => {
    const exertion = strengthExertion(2);
    const measurement = unwrap(
      strengthMeasurement({
        repetitions: 8,
        load: unwrap(kilograms(80)),
        exertion: unwrap(exertion),
      }),
    );
    const session = unwrap(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement,
        recordedAt: at(3),
      }),
    );
    expect(session.sets).toEqual([
      { setId: 'set-1', exerciseId: 'back-squat', sequence: 1, measurement, recordedAt: at(3) },
    ]);
    const recorded = session.sets[0]?.measurement;
    if (recorded?.profile !== 'strength') throw new Error('expected strength');
    expect(recorded.exertion?.rir.value).toBe(2);
    expect(recorded.exertion?.rpe.value).toBe(8);
  });

  it('records a unilateral set with its side and load semantics explicitly', () => {
    const measurement = unwrap(
      unilateralStrengthMeasurement({
        side: 'right',
        repetitions: 10,
        load: unwrap(kilograms(12)),
      }),
    );
    const session = unwrap(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'split-squat',
        measurement,
        recordedAt: at(5),
      }),
    );
    expect(session.sets[0]?.measurement).toMatchObject({
      profile: 'unilateral_strength',
      side: 'right',
      loadSemantics: 'per_side',
    });
  });

  it('numbers sets in the order they were recorded and leaves the previous value untouched', () => {
    const first = unwrap(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(3),
      }),
    );
    const second = unwrap(
      recordSet(first, {
        setId: 'set-2',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(6),
      }),
    );
    expect(second.sets.map((set) => set.sequence)).toEqual([1, 2]);
    expect(first.sets).toHaveLength(1);
  });

  it('cannot record a bare number', () => {
    const bare = {
      setId: 'set-1',
      exerciseId: 'back-squat',
      // @ts-expect-error a bare number is not a measurement
      measurement: 80,
      recordedAt: at(3),
    };
    expect(recordSet(started(), bare)).toEqual({
      ok: false,
      error: { kind: 'not_a_measurement', setId: 'set-1' },
    });
  });

  it.each([
    ['an object without a profile', { repetitions: 8, load: 80 }],
    ['an unknown profile', { profile: 'weights', schemaVersion: 1, repetitions: 8 }],
    ['a load without a unit', { profile: 'strength', schemaVersion: 1, repetitions: 8, load: 80 }],
    [
      'a load in the wrong unit',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, load: { unit: 's', value: 80 } },
    ],
    ['an unsupported schema version', { profile: 'strength', schemaVersion: 2, repetitions: 8 }],
    ['cardio without a duration quantity', { profile: 'cardio', schemaVersion: 1, duration: 1200 }],
    [
      'unilateral without load semantics',
      { profile: 'unilateral_strength', schemaVersion: 1, side: 'left', repetitions: 8 },
    ],
    // The fields the wire contract validates and this check used to walk past. A measurement
    // that reaches storage or the network is only as typed as the check that let it in, and
    // packages/contracts is the same contract with the same bounds (R-021, ADR-0004).
    [
      'a load above the maximum for its unit',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, load: { unit: 'kg', value: 1_001 } },
    ],
    [
      'a load carrying a field the contract does not define',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        load: { unit: 'kg', value: 80, estimated: true },
      },
    ],
    [
      'notes longer than the contract permits',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, notes: 'x'.repeat(2_001) },
    ],
    [
      'notes that are not a string',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, notes: 12 },
    ],
    [
      'an exertion of the wrong profile',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        exertion: { profile: 'cardio', borg: 12 },
      },
    ],
    [
      'reps in reserve outside the scale',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 11 },
          rpe: { kind: 'rpe_derived', value: 1 },
        },
      },
    ],
    [
      'reps in reserve off the half step',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2.25 },
          rpe: { kind: 'rpe_derived', value: 8 },
        },
      },
    ],
    [
      // The interpretation must follow from the observation, or a record asserts two
      // different efforts at once (ADR-0004).
      'an RPE that is not the one derived from the RIR',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2 },
          rpe: { kind: 'rpe_derived', value: 1 },
        },
      },
    ],
    [
      'a Borg rating outside 6 to 20',
      {
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 600 },
        exertion: { profile: 'cardio', borg: 21 },
      },
    ],
    [
      'a Borg rating that is not whole',
      {
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 600 },
        exertion: { profile: 'cardio', borg: 12.5 },
      },
    ],
    [
      'an incline outside the range the contract permits',
      {
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 600 },
        inclinePercent: 41,
      },
    ],
    [
      'an incline that is not a number',
      {
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 600 },
        inclinePercent: '10',
      },
    ],
    [
      'a field no profile defines',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, restSeconds: 90 },
    ],
    [
      'a field belonging to another profile',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, side: 'left' },
    ],
  ])('refuses %s at runtime', (_label, measurement) => {
    const result = recordSet(started(), {
      setId: 'set-1',
      exerciseId: 'back-squat',
      measurement: measurement as never,
      recordedAt: at(3),
    });
    expect(result).toEqual({ ok: false, error: { kind: 'not_a_measurement', setId: 'set-1' } });
  });

  it.each([
    [
      'notes at the limit',
      { profile: 'strength', schemaVersion: 1, repetitions: 8, notes: 'x'.repeat(2_000) },
    ],
    [
      'a strength exertion whose RPE follows from its RIR',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2.5 },
          rpe: { kind: 'rpe_derived', value: 7.5 },
        },
      },
    ],
    [
      'an RIR of nine or more, where the derived RPE bottoms out at one',
      {
        profile: 'strength',
        schemaVersion: 1,
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 9.5 },
          rpe: { kind: 'rpe_derived', value: 1 },
        },
      },
    ],
    [
      'a downhill incline and a Borg rating',
      {
        profile: 'cardio',
        schemaVersion: 1,
        duration: { unit: 's', value: 600 },
        inclinePercent: -20,
        exertion: { profile: 'cardio', borg: 6 },
      },
    ],
  ])('accepts %s, which the contract permits', (_label, measurement) => {
    // The control. A check that refused everything would pass every rejection above.
    const result = recordSet(started(), {
      setId: 'set-1',
      exerciseId: 'back-squat',
      measurement: measurement as never,
      recordedAt: at(3),
    });
    expect(result.ok, JSON.stringify(measurement)).toBe(true);
  });

  it('accepts cardio with a duration quantity', () => {
    const measurement = unwrap(cardioMeasurement({ duration: unwrap(seconds(600)) }));
    expect(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement,
        recordedAt: at(3),
      }).ok,
    ).toBe(true);
  });

  it('refuses an exercise outside the scheduled session', () => {
    expect(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'deadlift',
        measurement: squatTarget,
        recordedAt: at(3),
      }),
    ).toEqual({ ok: false, error: { kind: 'exercise_not_in_session', exerciseId: 'deadlift' } });
  });

  it('refuses a set id that was already recorded', () => {
    const once = unwrap(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(3),
      }),
    );
    expect(
      recordSet(once, {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(4),
      }),
    ).toEqual({ ok: false, error: { kind: 'duplicate_set', setId: 'set-1' } });
  });

  it('refuses a result recorded before the session started', () => {
    expect(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(-1),
      }),
    ).toEqual({ ok: false, error: { kind: 'recorded_before_start', setId: 'set-1' } });
  });
});

describe('completing a session', () => {
  it('completes an active session and keeps its results', () => {
    const withSet = unwrap(
      recordSet(started(), {
        setId: 'set-1',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(3),
      }),
    );
    const completed = unwrap(completeSession(withSet, at(40)));
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toEqual(at(40));
    expect(completed.sets).toEqual(withSet.sets);
  });

  it('refuses to complete twice, or to record after completion', () => {
    const completed = unwrap(completeSession(started(), at(40)));
    expect(completeSession(completed, at(41))).toEqual({
      ok: false,
      error: { kind: 'session_not_active', sessionId: 'workout-1' },
    });
    expect(
      recordSet(completed, {
        setId: 'set-9',
        exerciseId: 'back-squat',
        measurement: squatTarget,
        recordedAt: at(42),
      }),
    ).toEqual({ ok: false, error: { kind: 'session_not_active', sessionId: 'workout-1' } });
  });

  it('refuses a completion time before the start', () => {
    expect(completeSession(started(), at(-5))).toEqual({
      ok: false,
      error: { kind: 'completed_before_start', sessionId: 'workout-1' },
    });
  });
});
