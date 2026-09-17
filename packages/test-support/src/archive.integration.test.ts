import {
  exportArchive,
  exportHistoryCsv,
  HISTORY_CSV_COLUMNS,
  importArchive,
  logSet,
  startWorkout,
} from '@workout/application';
import { ARCHIVE_SCHEMA_VERSION } from '@workout/contracts';
import {
  cardioMeasurement,
  completeSession,
  kilograms,
  seconds,
  strengthMeasurement,
  unilateralStrengthMeasurement,
  unwrap,
} from '@workout/domain';
import { describe, expect, it } from 'vitest';
import { SYNTHETIC_USER_ID } from './builders.js';
import { FixedClock } from './in-memory-ports.js';
import { createWorkoutTestPorts, InMemoryLocalWorkoutStore } from './in-memory-workout.js';
import { aPlan } from './local-workout-store-cases.js';

/**
 * Export and import (data-portability spec, tasks 8.1 and 8.2).
 *
 * The round trip is the requirement: an export imported into a CLEAN instance must match what
 * was exported. Both instances here are the in-memory reference, which is the same reference
 * the IndexedDB adapter is held to by the store contract, so a round trip that works here is a
 * round trip between two compatible instances rather than between two copies of one bug.
 */

const user = SYNTHETIC_USER_ID;
const T0 = new Date('2026-09-14T10:00:00Z');

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
    notes: 'easy, "flat"',
  }),
);

async function aDeviceWithHistory() {
  const ports = createWorkoutTestPorts(T0);
  await ports.store.putPlan(user, aPlan());
  ports.plans.setActivePlan(user, aPlan());

  const started = await startWorkout(ports, { userId: user, scheduledSessionId: 'session-mon' });
  if (!started.ok) throw new Error('could not start the session');
  const sessionId = started.value.session.id;

  for (const measurement of [squat, splitSquat, treadmill]) {
    const logged = await logSet(ports, {
      userId: user,
      sessionId,
      exerciseId: 'back-squat',
      measurement,
    });
    if (!logged.ok) throw new Error(`could not log: ${JSON.stringify(logged.error)}`);
  }

  const current = await ports.store.findSession(user, sessionId);
  if (!current) throw new Error('the session vanished');
  await ports.store.putSession(user, unwrap(completeSession(current, T0)));
  return { ports, sessionId };
}

describe('the full JSON export (task 8.1)', () => {
  it('declares the schema version it was written against', async () => {
    const { ports } = await aDeviceWithHistory();
    const archive = await exportArchive({ source: ports.store, clock: ports.clock }, user);
    expect(archive.schemaVersion).toBe(ARCHIVE_SCHEMA_VERSION);
    expect(archive.exportedAt).toBe(T0.toISOString());
  });

  it('contains the plans, sessions, and results', async () => {
    const { ports, sessionId } = await aDeviceWithHistory();
    const archive = await exportArchive({ source: ports.store, clock: ports.clock }, user);
    expect(archive.plans.map((plan) => plan.id)).toEqual(['plan-1']);
    expect(archive.sessions.map((session) => session.id)).toEqual([sessionId]);
    expect(archive.sessions[0]?.sets).toHaveLength(3);
    expect(archive.sessions[0]?.status).toBe('completed');
  });

  it('round-trips into a clean instance', async () => {
    const { ports } = await aDeviceWithHistory();
    const archive = await exportArchive({ source: ports.store, clock: ports.clock }, user);

    const clean = new InMemoryLocalWorkoutStore();
    const imported = await importArchive({ sink: clean, source: clean }, user, archive);
    expect(imported.ok).toBe(true);
    expect(imported.ok && imported.value).toEqual({ plans: 1, sessions: 1, proposals: 0 });

    // Exported again from the clean instance: byte-for-byte the same document except the
    // moment of export, which is the only thing that legitimately differs.
    const again = await exportArchive({ source: clean, clock: new FixedClock(T0) }, user);
    expect(again).toEqual(archive);
  });

  it('refuses to import into an instance that already holds data', async () => {
    const { ports } = await aDeviceWithHistory();
    const archive = await exportArchive({ source: ports.store, clock: ports.clock }, user);
    const refused = await importArchive({ sink: ports.store, source: ports.store }, user, archive);
    expect(refused.ok).toBe(false);
    expect(refused.ok === false && refused.error.kind).toBe('instance_not_clean');
  });

  it('refuses a document written against another schema version', async () => {
    const clean = new InMemoryLocalWorkoutStore();
    const refused = await importArchive({ sink: clean, source: clean }, user, {
      schemaVersion: 99,
      exportedAt: T0.toISOString(),
      plans: [],
      sessions: [],
      proposals: [],
    });
    expect(refused.ok === false && refused.error).toEqual({
      kind: 'unsupported_version',
      received: 99,
    });
  });

  it('refuses a document carrying a field it does not understand, rather than dropping it', async () => {
    const { ports } = await aDeviceWithHistory();
    const archive = await exportArchive({ source: ports.store, clock: ports.clock }, user);
    const clean = new InMemoryLocalWorkoutStore();
    const refused = await importArchive({ sink: clean, source: clean }, user, {
      ...archive,
      somethingLater: { bodyweightKg: 82 },
    });
    expect(refused.ok === false && refused.error.kind).toBe('not_an_archive');
    expect(await clean.sessions(user)).toEqual([]);
  });

  it('refuses a measurement the domain could not have produced', async () => {
    // The shape is right and the value is not: RPE 9 does not follow from RIR 2. Casting the
    // payload into the domain type would have imported it as history.
    const { ports } = await aDeviceWithHistory();
    const archive = await exportArchive({ source: ports.store, clock: ports.clock }, user);
    const sets = archive.sessions[0]?.sets;
    if (!sets?.[0]) throw new Error('expected a set to tamper with');
    const tampered = structuredClone(archive);
    const target = tampered.sessions[0]?.sets[0];
    if (!target) throw new Error('expected a cloned set');
    Object.assign(target, {
      measurement: {
        ...target.measurement,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2 },
          rpe: { kind: 'rpe_derived', value: 9 },
        },
      },
    });

    const clean = new InMemoryLocalWorkoutStore();
    const refused = await importArchive({ sink: clean, source: clean }, user, tampered);
    expect(refused.ok).toBe(false);
    expect(await clean.sessions(user)).toEqual([]);
  });
});

describe('the CSV history export (task 8.2)', () => {
  it('names the unit of every quantity column', async () => {
    const { ports } = await aDeviceWithHistory();
    const csv = await exportHistoryCsv({ source: ports.store }, user);
    const header = csv.split('\r\n')[0]?.split(',') ?? [];
    expect(header).toEqual([...HISTORY_CSV_COLUMNS]);

    // Every column whose value is a number in some unit says which unit that is.
    for (const column of ['load_kg', 'duration_s', 'distance_m', 'incline_percent']) {
      expect(header, `${column} is missing from the header`).toContain(column);
      expect(column, `${column} does not name its unit`).toMatch(/_(kg|s|m|percent)$/);
    }

    // And no column is a bare quantity name, which is the mistake this guards against: a
    // spreadsheet opened a year later cannot ask what `load` was measured in.
    for (const bare of ['load', 'duration', 'distance', 'incline', 'weight', 'mass', 'time']) {
      expect(header, `${bare} is a quantity column with no unit`).not.toContain(bare);
    }
  });

  it('writes one row per set, with the profile, typed values, and the exertion scale', async () => {
    const { ports, sessionId } = await aDeviceWithHistory();
    const csv = await exportHistoryCsv({ source: ports.store }, user);
    const rows = csv.trimEnd().split('\r\n').slice(1);
    expect(rows).toHaveLength(3);

    const column = (row: string, name: (typeof HISTORY_CSV_COLUMNS)[number]) =>
      row.split(',')[HISTORY_CSV_COLUMNS.indexOf(name)];

    expect(column(rows[0] ?? '', 'session_id')).toBe(sessionId);
    expect(column(rows[0] ?? '', 'measurement_profile')).toBe('strength');
    expect(column(rows[0] ?? '', 'load_kg')).toBe('80');
    expect(column(rows[1] ?? '', 'measurement_profile')).toBe('unilateral_strength');
    expect(column(rows[1] ?? '', 'load_side')).toBe('left');
    expect(column(rows[1] ?? '', 'load_semantics')).toBe('per_side');
    expect(column(rows[2] ?? '', 'duration_s')).toBe('1200');
    expect(column(rows[2] ?? '', 'incline_percent')).toBe('2.5');
  });

  it('quotes a value that would otherwise change the shape of the file', async () => {
    const { ports } = await aDeviceWithHistory();
    const csv = await exportHistoryCsv({ source: ports.store }, user);
    // The cardio set's notes contain a comma and a quote.
    expect(csv).toContain('"easy, ""flat"""');
    expect(csv.trimEnd().split('\r\n')).toHaveLength(4);
  });

  it('is empty but still self-describing when there is no history', async () => {
    const csv = await exportHistoryCsv({ source: new InMemoryLocalWorkoutStore() }, user);
    expect(csv).toBe(`${HISTORY_CSV_COLUMNS.join(',')}\r\n`);
  });
});
