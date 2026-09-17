/**
 * Deterministic design-system fixtures (governance.def.fixtures).
 *
 * Seeded, synthetic data with a fixed clock: 2026-09-14 10:00 UTC. Visual baselines and
 * reference screens render only this, so a screenshot can never depend on the day it runs.
 * These are presentation fixtures, not product behaviour.
 */
import type { PlanDiff, ScheduledSession } from '@workout/domain';
import type { Route } from 'next';
import type { TabHrefs } from '../patterns/Bars';
import type { SetRow } from '../patterns/SetTable';

export const FIXED_NOW = Date.UTC(2026, 8, 14, 10, 0, 0);

/**
 * In-page anchors for reference screens. Product routes pass real hrefs; these screens are
 * examples in Storybook and link nowhere.
 */
export const REFERENCE_TAB_HREFS: TabHrefs = {
  today: '#today' as Route,
  history: '#history' as Route,
  settings: '#settings' as Route,
};
export const REFERENCE_WORKOUT_HREF = '#workout' as Route;
export const FIXTURE_TIME_ZONE = 'UTC';

export const REST = { durationSeconds: 90, startedAt: FIXED_NOW - 30_000 } as const;

export const CURRENT_EXERCISE = {
  name: 'Back squat',
  index: 2,
  total: 5,
  set: { current: 2, done: 1, total: 4 },
  target: { loadKg: 80, reps: 8, rir: '2' },
  deltaKg: 2.5,
} as const;

export const PLAN = {
  name: 'Lower body A',
  proposedAt: FIXED_NOW - 86_400_000,
  exercises: [
    { name: 'Back squat', sets: 4, loadKg: 80, reps: 8 },
    { name: 'Romanian deadlift', sets: 3, loadKg: 70, reps: 10 },
    { name: 'Split squat', sets: 3, loadKg: 20, reps: 10 },
    { name: 'Leg curl', sets: 3, loadKg: 35, reps: 12 },
    { name: 'Calf raise', sets: 3, loadKg: 60, reps: 15 },
  ],
} as const;

export const SQUAT_SETS: readonly SetRow[] = [
  { set: 1, loadKg: 80, reps: 8, rir: 3 },
  { set: 2, loadKg: 80, reps: 8, rir: 2 },
  { set: 3, loadKg: 82.5, reps: 7, rir: 1 },
  { set: 4, loadKg: 82.5, reps: 6 },
];

export const DEADLIFT_SETS: readonly SetRow[] = [
  { set: 1, loadKg: 70, reps: 10, rir: 3 },
  { set: 2, loadKg: 70, reps: 10, rir: 2 },
  { set: 3, reps: 9, rir: 1 },
];

export const HISTORY = [
  { id: 'w3', date: FIXED_NOW - 2 * 86_400_000, name: 'Upper body B', exercises: 5, sets: 17 },
  { id: 'w2', date: FIXED_NOW - 4 * 86_400_000, name: 'Lower body A', exercises: 5, sets: 16 },
  { id: 'w1', date: FIXED_NOW - 7 * 86_400_000, name: 'Upper body A', exercises: 4, sets: 14 },
] as const;

/** A pending agent proposal against the fixture plan (agent-proposals spec). */
export const PROPOSAL: {
  readonly baseRevision: number;
  readonly createdAt: number;
  readonly rationale: string;
  readonly exerciseNames: Readonly<Record<string, string>>;
  readonly planSessions: readonly ScheduledSession[];
  readonly diff: PlanDiff;
} = {
  baseRevision: 12,
  createdAt: FIXED_NOW - 24.5 * 3_600_000,
  // Untrusted agent text, including markup that must be shown literally, never rendered.
  rationale:
    '<b>Squat</b> moved well at 80 kg with RIR 3 on every set, so add 2.5 kg.\nTuesday clashes with travel, so move that session one day later.',
  exerciseNames: { 'back-squat': 'Back squat' },
  planSessions: [
    {
      id: 'session-tue',
      scheduledFor: '2026-09-15',
      exercises: [
        {
          exerciseId: 'back-squat',
          prescription: {
            profile: 'strength',
            schemaVersion: 1,
            repetitions: 8,
            load: { unit: 'kg', value: 80 },
          },
        },
      ],
    },
  ],
  diff: {
    op: 'change_scheduled_session',
    sessionId: 'session-tue',
    scheduledFor: '2026-09-16',
    exercises: [
      {
        exerciseId: 'back-squat',
        prescription: {
          profile: 'strength',
          schemaVersion: 1,
          repetitions: 8,
          load: { unit: 'kg', value: 82.5 },
        },
      },
    ],
  },
};
