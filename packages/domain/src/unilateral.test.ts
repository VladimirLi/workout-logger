import { describe, expect, it } from 'vitest';
import {
  activatePlan,
  kilograms,
  recordSet,
  startSession,
  unilateralStrengthMeasurement,
  unwrap,
} from './index.js';

/**
 * Unilateral entry (workout-logging spec, owner decision 2026-09-18).
 *
 * Each side is its own result, load is per-side unless the plan says otherwise, and combined
 * load is refused for an exercise the plan does not configure to permit it. The permission is
 * snapshotted into the session at start: a plan edited mid-workout must not change what the
 * set the user is about to record is allowed to mean.
 */

const T0 = new Date('2026-09-18T10:00:00Z');
const load = unwrap(kilograms(22.5));

function planWith(combined: boolean) {
  return unwrap(
    activatePlan(undefined, {
      id: 'plan-1',
      activatedAt: T0,
      sessions: [
        {
          id: 'session-mon',
          scheduledFor: '2026-09-18',
          exercises: [
            {
              exerciseId: 'split-squat',
              prescription: unwrap(
                unilateralStrengthMeasurement({ repetitions: 10, side: 'left', load }),
              ),
              ...(combined ? { combinedLoadPermitted: true } : {}),
            },
          ],
        },
      ],
    }),
  ).activated;
}

const started = (combined: boolean) =>
  unwrap(
    startSession(planWith(combined), {
      id: 'workout-1',
      scheduledSessionId: 'session-mon',
      startedAt: T0,
    }),
  );

const set = (side: 'left' | 'right', semantics?: 'per_side' | 'total') =>
  unwrap(
    unilateralStrengthMeasurement({
      repetitions: 10,
      side,
      load,
      ...(semantics ? { loadSemantics: semantics } : {}),
    }),
  );

describe('unilateral entry', () => {
  it('defaults load to per-side when nothing is chosen', () => {
    expect(set('left').loadSemantics).toBe('per_side');
  });

  it('records each side as its own result', () => {
    const session = started(false);
    const left = unwrap(
      recordSet(session, {
        setId: 'set-1',
        exerciseId: 'split-squat',
        measurement: set('left'),
        recordedAt: T0,
      }),
    );
    const both = unwrap(
      recordSet(left, {
        setId: 'set-2',
        exerciseId: 'split-squat',
        measurement: set('right'),
        recordedAt: T0,
      }),
    );

    expect(both.sets).toHaveLength(2);
    expect(both.sets.map((recorded) => recorded.measurement)).toMatchObject([
      { side: 'left', loadSemantics: 'per_side' },
      { side: 'right', loadSemantics: 'per_side' },
    ]);
  });

  it('snapshots which exercises may use combined load', () => {
    expect(started(true).combinedLoadExercises).toEqual(['split-squat']);
    expect(started(false).combinedLoadExercises).toEqual([]);
  });

  it('refuses combined load for an exercise the plan does not permit it for', () => {
    const refused = recordSet(started(false), {
      setId: 'set-1',
      exerciseId: 'split-squat',
      measurement: set('left', 'total'),
      recordedAt: T0,
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error).toEqual({
      kind: 'combined_load_not_permitted',
      exerciseId: 'split-squat',
    });
  });

  it('accepts combined load where the plan permits it, and records it explicitly', () => {
    const recorded = unwrap(
      recordSet(started(true), {
        setId: 'set-1',
        exerciseId: 'split-squat',
        measurement: set('left', 'total'),
        recordedAt: T0,
      }),
    );
    expect(recorded.sets[0]?.measurement).toMatchObject({
      side: 'left',
      loadSemantics: 'total',
    });
  });

  it('still accepts per-side on an exercise that permits combined load', () => {
    const recorded = unwrap(
      recordSet(started(true), {
        setId: 'set-1',
        exerciseId: 'split-squat',
        measurement: set('right'),
        recordedAt: T0,
      }),
    );
    expect(recorded.sets[0]?.measurement).toMatchObject({ loadSemantics: 'per_side' });
  });
});
