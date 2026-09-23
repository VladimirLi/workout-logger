import { describe, expect, it } from 'vitest';
import { cardioMeasurement, strengthMeasurement } from './measurement.js';
import {
  activatePlan,
  applyPlanDiff,
  changeExercisePrescription,
  changeScheduledSession,
  findScheduledSession,
  type Plan,
  replacePlanSessions,
} from './plan.js';
import type { ScheduledSession } from './plan-diff.js';
import { unwrap } from './result.js';
import { revision } from './revision.js';
import { kilograms, seconds } from './units.js';

/**
 * The active plan (workout-planning spec, ADR-0002).
 *
 * The revision is what an agent proposal is checked against, so every accepted change to the
 * plan or its sessions must move it forward, and nothing else may.
 */

const ACTIVATED_AT = new Date('2026-09-14T08:00:00Z');

const squat = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(80)) }));
const treadmill = unwrap(cardioMeasurement({ duration: unwrap(seconds(1200)) }));

const monday: ScheduledSession = {
  id: 'session-mon',
  scheduledFor: '2026-09-14',
  exercises: [{ exerciseId: 'back-squat', prescription: squat }],
};
const wednesday: ScheduledSession = {
  id: 'session-wed',
  scheduledFor: '2026-09-16',
  exercises: [{ exerciseId: 'treadmill', prescription: treadmill }],
};

function firstPlan(): Plan {
  return unwrap(
    activatePlan(undefined, {
      id: 'plan-1',
      sessions: [monday, wednesday],
      activatedAt: ACTIVATED_AT,
    }),
  ).activated;
}

describe('activating a plan', () => {
  it('starts the first plan active at revision 1 with its scheduled sessions', () => {
    const plan = firstPlan();
    expect(plan.status).toBe('active');
    expect(plan.revision).toBe(unwrap(revision(1)));
    expect(plan.sessions).toEqual([monday, wednesday]);
    expect(plan.activatedAt).toEqual(ACTIVATED_AT);
  });

  it('supersedes the previous active plan and keeps its history', () => {
    const previous = firstPlan();
    const supersededAt = new Date('2026-09-20T08:00:00Z');
    const { activated, superseded } = unwrap(
      activatePlan(previous, { id: 'plan-2', sessions: [wednesday], activatedAt: supersededAt }),
    );

    expect(activated.status).toBe('active');
    expect(superseded?.status).toBe('superseded');
    expect(superseded?.supersededAt).toEqual(supersededAt);
    // History retained: the superseded plan still has everything it had.
    expect(superseded?.sessions).toEqual(previous.sessions);
    expect(superseded?.revision).toBe(previous.revision);
  });

  it('gives the new plan a revision after the superseded one, so old proposals are stale', () => {
    const previous = firstPlan();
    const { activated } = unwrap(
      activatePlan(previous, { id: 'plan-2', sessions: [wednesday], activatedAt: ACTIVATED_AT }),
    );
    expect(activated.revision).toBeGreaterThan(previous.revision);
  });

  it('refuses to supersede a plan that is not active', () => {
    const previous = firstPlan();
    const { superseded } = unwrap(
      activatePlan(previous, { id: 'plan-2', sessions: [], activatedAt: ACTIVATED_AT }),
    );
    const result = activatePlan(superseded, {
      id: 'plan-3',
      sessions: [],
      activatedAt: ACTIVATED_AT,
    });
    expect(result).toEqual({ ok: false, error: { kind: 'plan_not_active', planId: 'plan-1' } });
  });

  it('refuses duplicate scheduled session ids', () => {
    const result = activatePlan(undefined, {
      id: 'plan-1',
      sessions: [monday, { ...wednesday, id: monday.id }],
      activatedAt: ACTIVATED_AT,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: 'duplicate_session', sessionId: 'session-mon' },
    });
  });

  it('refuses the same exercise twice in one session', () => {
    const result = activatePlan(undefined, {
      id: 'plan-1',
      sessions: [{ ...monday, exercises: [...monday.exercises, ...monday.exercises] }],
      activatedAt: ACTIVATED_AT,
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: 'duplicate_exercise', sessionId: 'session-mon', exerciseId: 'back-squat' },
    });
  });

  it.each(['2026-9-14', '14/09/2026', '2026-02-30', ''])(
    'refuses the scheduled date %j',
    (scheduledFor) => {
      const result = activatePlan(undefined, {
        id: 'plan-1',
        sessions: [{ ...monday, scheduledFor }],
        activatedAt: ACTIVATED_AT,
      });
      expect(result).toEqual({
        ok: false,
        error: { kind: 'invalid_scheduled_date', sessionId: 'session-mon', received: scheduledFor },
      });
    },
  );

  it('encodes no progression rule: a plan is sessions and prescriptions only', () => {
    expect(Object.keys(firstPlan()).sort()).toEqual([
      'activatedAt',
      'id',
      'revision',
      'sessions',
      'status',
    ]);
  });
});

describe('the monotonic plan revision', () => {
  const heavier = unwrap(strengthMeasurement({ repetitions: 8, load: unwrap(kilograms(82.5)) }));

  it('advances when an exercise prescription changes', () => {
    const plan = firstPlan();
    const changed = unwrap(changeExercisePrescription(plan, 'session-mon', 'back-squat', heavier));
    expect(changed.revision).toBeGreaterThan(plan.revision);
    expect(findScheduledSession(changed, 'session-mon')?.exercises[0]?.prescription).toEqual(
      heavier,
    );
  });

  it('advances when a scheduled session is moved or its exercises change', () => {
    const plan = firstPlan();
    const moved = unwrap(
      changeScheduledSession(plan, { sessionId: 'session-wed', scheduledFor: '2026-09-17' }),
    );
    expect(moved.revision).toBeGreaterThan(plan.revision);
    expect(findScheduledSession(moved, 'session-wed')?.scheduledFor).toBe('2026-09-17');

    const refilled = unwrap(
      changeScheduledSession(moved, { sessionId: 'session-wed', exercises: monday.exercises }),
    );
    expect(refilled.revision).toBeGreaterThan(moved.revision);
  });

  it('advances when the sessions are replaced', () => {
    const plan = firstPlan();
    const replaced = unwrap(replacePlanSessions(plan, [wednesday]));
    expect(replaced.revision).toBeGreaterThan(plan.revision);
    expect(replaced.sessions).toEqual([wednesday]);
  });

  it('applies a replace_plan diff through applyPlanDiff', () => {
    const plan = firstPlan();
    const applied = unwrap(applyPlanDiff(plan, { op: 'replace_plan', sessions: [wednesday] }));
    expect(applied.sessions).toEqual([wednesday]);
    expect(applied.revision).toBeGreaterThan(plan.revision);
  });

  it('applies a change_scheduled_session diff through applyPlanDiff', () => {
    const plan = firstPlan();
    const applied = unwrap(
      applyPlanDiff(plan, {
        op: 'change_scheduled_session',
        sessionId: 'session-mon',
        scheduledFor: '2026-09-19',
      }),
    );
    expect(findScheduledSession(applied, 'session-mon')?.scheduledFor).toBe('2026-09-19');
  });

  it('refuses to treat a completed-session correction as a plan change', () => {
    const plan = firstPlan();
    expect(
      applyPlanDiff(plan, {
        op: 'correct_completed_session',
        sessionId: 'session-1',
        corrections: [],
      }),
    ).toEqual({
      ok: false,
      error: { kind: 'not_a_plan_change', op: 'correct_completed_session' },
    });
  });

  it('does not advance when the plan is read', () => {
    const plan = firstPlan();
    const before = plan.revision;
    findScheduledSession(plan, 'session-mon');
    findScheduledSession(plan, 'missing');
    expect(plan.revision).toBe(before);
  });

  it('leaves the original plan value untouched by a change', () => {
    const plan = firstPlan();
    unwrap(changeExercisePrescription(plan, 'session-mon', 'back-squat', heavier));
    expect(plan.revision).toBe(unwrap(revision(1)));
    expect(findScheduledSession(plan, 'session-mon')?.exercises[0]?.prescription).toEqual(squat);
  });

  it('refuses a change to an unknown session or exercise without advancing', () => {
    const plan = firstPlan();
    expect(changeExercisePrescription(plan, 'missing', 'back-squat', heavier)).toEqual({
      ok: false,
      error: { kind: 'session_not_found', sessionId: 'missing' },
    });
    expect(changeExercisePrescription(plan, 'session-mon', 'deadlift', heavier)).toEqual({
      ok: false,
      error: { kind: 'exercise_not_found', sessionId: 'session-mon', exerciseId: 'deadlift' },
    });
    expect(changeScheduledSession(plan, { sessionId: 'missing' })).toEqual({
      ok: false,
      error: { kind: 'session_not_found', sessionId: 'missing' },
    });
  });

  it('refuses a session change that introduces an invalid date or duplicate exercise', () => {
    const plan = firstPlan();
    expect(
      changeScheduledSession(plan, { sessionId: 'session-mon', scheduledFor: 'soon' }),
    ).toEqual({
      ok: false,
      error: { kind: 'invalid_scheduled_date', sessionId: 'session-mon', received: 'soon' },
    });
    expect(replacePlanSessions(plan, [monday, monday])).toEqual({
      ok: false,
      error: { kind: 'duplicate_session', sessionId: 'session-mon' },
    });
  });

  it('refuses any change to a superseded plan', () => {
    const { superseded } = unwrap(
      activatePlan(firstPlan(), { id: 'plan-2', sessions: [], activatedAt: ACTIVATED_AT }),
    );
    if (!superseded) throw new Error('expected a superseded plan');
    const refused = { ok: false, error: { kind: 'plan_not_active', planId: 'plan-1' } };
    expect(changeExercisePrescription(superseded, 'session-mon', 'back-squat', heavier)).toEqual(
      refused,
    );
    expect(changeScheduledSession(superseded, { sessionId: 'session-mon' })).toEqual(refused);
    expect(replacePlanSessions(superseded, [])).toEqual(refused);
  });
});

describe('scheduled session prescriptions', () => {
  it('stores a prescribed load as a quantity with a unit', () => {
    const prescription = findScheduledSession(firstPlan(), 'session-mon')?.exercises[0]
      ?.prescription;
    expect(prescription?.profile).toBe('strength');
    if (prescription?.profile !== 'strength') return;
    expect(prescription.load).toEqual({ unit: 'kg', value: 80 });
  });

  it('prescribes treadmill work with the cardio profile', () => {
    const prescription = findScheduledSession(firstPlan(), 'session-wed')?.exercises[0]
      ?.prescription;
    expect(prescription?.profile).toBe('cardio');
  });
});
