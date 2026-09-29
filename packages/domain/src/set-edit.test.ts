import { describe, expect, it } from 'vitest';
import { strengthExertion } from './exertion.js';
import {
  cardioMeasurement,
  strengthMeasurement,
  unilateralStrengthMeasurement,
} from './measurement.js';
import { activatePlan } from './plan.js';
import { unwrap } from './result.js';
import {
  type ActiveSession,
  completeSession,
  deleteSet,
  editSet,
  liveSets,
  recordSet,
  restoreSet,
  startSession,
} from './session.js';
import { kilograms, seconds } from './units.js';

/**
 * Editing and deleting a recorded set (spec D-23, D-24). A delete is a tombstone so the
 * numbers stay unique and an undo can put the set back where it was.
 */

const STARTED_AT = new Date('2026-09-14T10:00:00Z');
const at = (minutes: number) => new Date(STARTED_AT.getTime() + minutes * 60_000);
const strength = (repetitions: number, load = 80) =>
  unwrap(strengthMeasurement({ repetitions, load: unwrap(kilograms(load)) }));
const perSide = (loadSemantics: 'per_side' | 'total') =>
  unwrap(
    unilateralStrengthMeasurement({
      side: 'left',
      repetitions: 8,
      load: unwrap(kilograms(12)),
      loadSemantics,
    }),
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
          { exerciseId: 'back-squat', prescription: strength(8) },
          { exerciseId: 'split-squat', prescription: perSide('per_side') },
        ],
      },
    ],
  }),
).activated;

/** Four squat sets, numbered 1..4 in the session. */
function withFourSets(): ActiveSession {
  let session: ActiveSession = unwrap(
    startSession(plan, { id: 'w', scheduledSessionId: 'session-mon', startedAt: STARTED_AT }),
  );
  for (const n of [1, 2, 3, 4]) {
    session = unwrap(
      recordSet(session, {
        setId: `set-${n}`,
        exerciseId: 'back-squat',
        measurement: strength(n + 4),
        recordedAt: at(n),
      }),
    );
  }
  return session;
}

describe('editing a set', () => {
  it('changes the result and when it was edited, and nothing else about the set', () => {
    const session = withFourSets();
    const edited = unwrap(
      editSet(session, { setId: 'set-2', measurement: strength(12, 90), editedAt: at(10) }),
    );
    expect(edited.sets[1]).toEqual({
      ...session.sets[1],
      measurement: strength(12, 90),
      editedAt: at(10),
    });
    expect(edited.sets.filter((_, i) => i !== 1)).toEqual(session.sets.filter((_, i) => i !== 1));
    expect(session.sets[1]?.measurement).toEqual(strength(6));
  });

  it('accepts an exertion change on the same profile', () => {
    const measurement = unwrap(
      strengthMeasurement({
        repetitions: 6,
        load: unwrap(kilograms(80)),
        exertion: unwrap(strengthExertion(2)),
      }),
    );
    expect(editSet(withFourSets(), { setId: 'set-1', measurement, editedAt: at(9) }).ok).toBe(true);
  });

  it('refuses a set that does not exist, a deleted one, and a finished session', () => {
    const session = withFourSets();
    const input = { measurement: strength(9), editedAt: at(9) };
    expect(editSet(session, { setId: 'nope', ...input })).toEqual({
      ok: false,
      error: { kind: 'set_not_found', setId: 'nope' },
    });
    const deleted = unwrap(deleteSet(session, 'set-2', at(8)));
    expect(editSet(deleted, { setId: 'set-2', ...input })).toEqual({
      ok: false,
      error: { kind: 'set_deleted', setId: 'set-2' },
    });
    const done = unwrap(completeSession(session, at(20)));
    expect(editSet(done, { setId: 'set-2', ...input })).toEqual({
      ok: false,
      error: { kind: 'session_not_active', sessionId: 'w' },
    });
  });

  it('refuses a result that is not a measurement, or that changes the profile', () => {
    const session = withFourSets();
    expect(
      editSet(session, {
        setId: 'set-1',
        measurement: { profile: 'strength' } as never,
        editedAt: at(9),
      }),
    ).toEqual({ ok: false, error: { kind: 'not_a_measurement', setId: 'set-1' } });
    expect(
      editSet(session, {
        setId: 'set-1',
        measurement: unwrap(cardioMeasurement({ duration: unwrap(seconds(600)) })),
        editedAt: at(9),
      }),
    ).toEqual({ ok: false, error: { kind: 'measurement_profile_changed', setId: 'set-1' } });
    expect(
      editSet(session, {
        setId: 'set-1',
        measurement: perSide('per_side'),
        editedAt: at(9),
      }),
    ).toEqual({ ok: false, error: { kind: 'measurement_profile_changed', setId: 'set-1' } });
  });

  it('holds an edit to the combined-load rule the plan set', () => {
    let session: ActiveSession = unwrap(
      startSession(plan, { id: 'w', scheduledSessionId: 'session-mon', startedAt: STARTED_AT }),
    );
    session = unwrap(
      recordSet(session, {
        setId: 'lunge-1',
        exerciseId: 'split-squat',
        measurement: perSide('per_side'),
        recordedAt: at(1),
      }),
    );
    expect(
      editSet(session, { setId: 'lunge-1', measurement: perSide('total'), editedAt: at(2) }),
    ).toEqual({
      ok: false,
      error: { kind: 'combined_load_not_permitted', exerciseId: 'split-squat' },
    });
  });
});

describe('deleting and restoring a set', () => {
  it('keeps the set as a tombstone, so numbers stay unique and live sets close up', () => {
    const session = withFourSets();
    const deleted = unwrap(deleteSet(session, 'set-2', at(8)));
    expect(deleted.sets).toHaveLength(4);
    expect(deleted.sets[1]?.deletedAt).toEqual(at(8));
    expect(liveSets(deleted).map((set) => set.setId)).toEqual(['set-1', 'set-3', 'set-4']);

    const next = unwrap(
      recordSet(deleted, {
        setId: 'set-5',
        exerciseId: 'back-squat',
        measurement: strength(9),
        recordedAt: at(9),
      }),
    );
    expect(next.sets.map((set) => set.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('restores a deleted set with its value and its position', () => {
    const session = withFourSets();
    const restored = unwrap(restoreSet(unwrap(deleteSet(session, 'set-2', at(8))), 'set-2'));
    expect(restored).toEqual(session);
  });

  it('keeps an edit made before a delete through an undo', () => {
    const edited = unwrap(
      editSet(withFourSets(), { setId: 'set-2', measurement: strength(12), editedAt: at(7) }),
    );
    const roundTrip = unwrap(restoreSet(unwrap(deleteSet(edited, 'set-2', at(8))), 'set-2'));
    expect(roundTrip).toEqual(edited);
  });

  it('refuses to delete twice, to restore a live set, or to touch a missing one', () => {
    const session = withFourSets();
    const deleted = unwrap(deleteSet(session, 'set-2', at(8)));
    expect(deleteSet(deleted, 'set-2', at(9))).toEqual({
      ok: false,
      error: { kind: 'set_deleted', setId: 'set-2' },
    });
    expect(restoreSet(session, 'set-2')).toEqual({
      ok: false,
      error: { kind: 'set_not_deleted', setId: 'set-2' },
    });
    expect(deleteSet(session, 'nope', at(9))).toEqual({
      ok: false,
      error: { kind: 'set_not_found', setId: 'nope' },
    });
    expect(restoreSet(session, 'nope')).toEqual({
      ok: false,
      error: { kind: 'set_not_found', setId: 'nope' },
    });
  });

  it('is final once the session is completed', () => {
    const deleted = unwrap(deleteSet(withFourSets(), 'set-2', at(8)));
    const done = unwrap(completeSession(deleted, at(20)));
    expect(restoreSet(done, 'set-2')).toEqual({
      ok: false,
      error: { kind: 'session_not_active', sessionId: 'w' },
    });
    expect(liveSets(done)).toHaveLength(3);
  });
});
