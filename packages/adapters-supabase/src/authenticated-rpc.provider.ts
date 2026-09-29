import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { select, upsert } from './rest.js';
import {
  A_MEASUREMENT,
  aPlanRow,
  aProposalRow,
  at,
  COMBINED_LOAD_EXERCISES,
  EXERCISE,
  PRESCRIBED_EXERCISES,
  SCHEDULED_SESSION,
  SCHEDULED_SESSION_ID,
} from './test-fixtures.js';
import { signInDevelopmentUser } from './test-identity.js';

/**
 * The trusted boundary, as a signed-in user reaches it (ADR-0012's invariant matrix).
 *
 * Every case here is one row of that matrix: a thing the server must establish for itself, and
 * the attempt that would get it wrong if the server took the caller's word. They run with a real
 * user token, never the service role, because the service role bypasses row-level security and
 * every grant - which is how a function that updated a table the role had no privilege on, and
 * six tables any user could write directly, both went unnoticed.
 *
 * `.provider.ts`, so `pnpm verify` never runs it. Run it with `pnpm test:provider`.
 */

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
const secretKey = process.env['SUPABASE_SECRET_KEY'];
if (!url || !publishableKey || !secretKey) {
  throw new Error('the provider suite needs .env.local; run `pnpm test:provider`.');
}

const config = serverConfig({ url, publishableKey, secretKey });
if (!config.ok) throw new Error(`invalid Supabase configuration: ${JSON.stringify(config.error)}`);
const server = config.value;
const rest = { url: server.url, key: server.secretKey };
const admin = { apikey: server.secretKey };

let user: { id: string; accessToken: string };

/** The four functions a signed-in user is meant to call. Everything else in `public` is internal. */
const BOUNDARY_FUNCTIONS = [
  'accept_proposal',
  'reject_proposal',
  'mark_proposal_stale_if_pending',
  'apply_workout_mutation',
];

/**
 * Every other function the migrations define, read from the migrations themselves.
 *
 * The deployed half of this is `scripts/check-db-boundary.mjs`, which derives the same set from
 * the schema. Both stopped being lists for the same reason: migration 20260919170000 added five
 * helpers and neither audit knew about them.
 */
function helperFunctionsInMigrations(): string[] {
  const directory = resolve('supabase/migrations');
  const names = new Set<string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.sql'))) {
    const sql = readFileSync(join(directory, file), 'utf8');
    for (const match of sql.matchAll(
      /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.([a-z_][a-z0-9_]*)/gi,
    )) {
      if (match[1] !== undefined) names.add(match[1]);
    }
    // A function a later migration withdrew is not deployed and cannot be called.
    for (const match of sql.matchAll(
      /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?public\.([a-z_][a-z0-9_]*)/gi,
    )) {
      if (match[1] !== undefined) names.delete(match[1]);
    }
  }
  return [...names].filter((name) => !BOUNDARY_FUNCTIONS.includes(name)).sort();
}

const PLAN = 'plan-rpc';
const SESSION = 'workout-1';
const KEY = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

/** A distinct key per delivery, so a case is never answered by another case's replay. */
let keyCounter = 0;
function aKey(): string {
  keyCounter += 1;
  return `aaaaaaaa-2222-4222-8222-${String(keyCounter).padStart(12, '0')}`;
}

/** An RPC call as the signed-in user: their token, the anonymous key, exactly like a browser. */
async function callAsUser(
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${server.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: server.publishableKey,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

/** A direct write as the signed-in user, for the cases about what the tables permit. */
async function writeAsUser(
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<number> {
  const response = await fetch(`${server.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: server.publishableKey,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return response.status;
}

/** Empties this user's rows, and seeds an active plan at revision 5 with one scheduled session. */
async function reset(options: { plan?: boolean } = {}): Promise<void> {
  for (const table of [
    'recorded_sets',
    'session_corrections',
    'idempotency_records',
    'proposals',
    'workout_sessions',
    'plans',
  ]) {
    await fetch(`${server.url}/rest/v1/${table}?user_id=eq.${user.id}`, {
      method: 'DELETE',
      headers: admin,
    });
  }
  if (options.plan !== false) {
    await upsert(rest, 'plans', [aPlanRow(user.id, { id: PLAN, revision: 5 })]);
  }
}

/** The payload a device sends to start a session: an intent, not a set of plan facts. */
const aStartSession = (id: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'start_session',
  session: {
    id,
    planId: PLAN,
    scheduledSessionId: SCHEDULED_SESSION_ID,
    startedAt: at(-30),
    ...overrides,
  },
});

const aRecordSet = (set: Record<string, unknown>) => ({
  kind: 'record_set',
  sessionId: SESSION,
  set: {
    setId: 'set-1',
    exerciseId: EXERCISE.perSide,
    measurement: A_MEASUREMENT,
    recordedAt: at(-20),
    ...set,
  },
});

async function startASession(): Promise<void> {
  const outcome = await callAsUser('apply_workout_mutation', {
    p_key: KEY,
    p_mutation: aStartSession(SESSION),
  });
  if (outcome.status !== 200) {
    throw new Error(`the fixture session could not start: ${JSON.stringify(outcome.body)}`);
  }
}

beforeAll(async () => {
  user = await signInDevelopmentUser(server, 'rpc-user@workout-logger.invalid');
}, 120_000);

describe('applying a mutation as the signed-in user', () => {
  it('succeeds with only the privileges that role has (I-1, I-21)', async () => {
    await reset();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: KEY,
      p_mutation: aStartSession(SESSION),
    });

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body).toMatchObject({ kind: 'applied' });

    const sessions = await select<{ id: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}`,
    );
    expect(sessions.map((session) => session.id)).toEqual([SESSION]);
  });

  it('derives the session’s plan facts from the plan, not the payload (I-14)', async () => {
    // The payload names an intent: which plan, which scheduled session, when it started. The
    // revision, the prescribed exercises and the combined-load permission are the plan's, read
    // under lock, exactly as `startSession` derives them in the domain.
    await reset();
    await startASession();

    const sessions = await select<{
      plan_revision: number;
      exercise_ids: string[];
      combined_load_exercises: string[];
    }>(rest, 'workout_sessions', `user_id=eq.${user.id}&id=eq.${SESSION}`);
    expect(sessions[0]?.plan_revision).toBe(5);
    expect(sessions[0]?.exercise_ids).toEqual(PRESCRIBED_EXERCISES);
    expect(sessions[0]?.combined_load_exercises).toEqual(COMBINED_LOAD_EXERCISES);
  });

  it('refuses a session whose claimed plan facts disagree with the plan (I-14)', async () => {
    await reset();
    for (const overrides of [
      { planRevision: 99 },
      { exerciseIds: ['whatever-i-like'] },
      { combinedLoadExercises: PRESCRIBED_EXERCISES },
    ]) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: aStartSession(SESSION, overrides),
      });
      expect(outcome.status, JSON.stringify(overrides)).toBeGreaterThanOrEqual(400);
    }
    expect(await select(rest, 'workout_sessions', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('accepts a session that carries the plan facts correctly (I-14)', async () => {
    // The control: agreement is allowed, so the refusal above is about disagreement and not
    // about the fields being present.
    await reset();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aStartSession(SESSION, {
        planRevision: 5,
        exerciseIds: PRESCRIBED_EXERCISES,
        combinedLoadExercises: COMBINED_LOAD_EXERCISES,
      }),
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
  });

  it('refuses a scheduled session the active plan does not have (I-14)', async () => {
    await reset();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aStartSession(SESSION, { scheduledSessionId: 'session-never' }),
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
  });

  it('detects a different payload under the same key without trusting the caller (I-22)', async () => {
    await reset();
    await startASession();

    const conflicting = await callAsUser('apply_workout_mutation', {
      p_key: KEY,
      p_mutation: aStartSession('workout-2'),
    });
    expect(conflicting.body).toMatchObject({ kind: 'key_reused' });

    const sessions = await select<{ id: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}`,
    );
    expect(sessions.map((session) => session.id)).toEqual([SESSION]);
  });

  it('replays the identical payload (I-22)', async () => {
    await reset();
    await startASession();
    const replay = await callAsUser('apply_workout_mutation', {
      p_key: KEY,
      p_mutation: aStartSession(SESSION),
    });
    expect(replay.body).toMatchObject({ kind: 'replayed' });
  });

  it('refuses a mutation it cannot recognise (I-12)', async () => {
    await reset();
    for (const mutation of [
      { kind: 'drop_everything' },
      { kind: 'start_session' },
      { kind: 'start_session', session: { id: 'x' } },
      { kind: 'start_session', session: 'not-an-object' },
    ]) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: mutation,
      });
      expect(outcome.status, JSON.stringify(mutation)).toBeGreaterThanOrEqual(400);
    }
    expect(await select(rest, 'workout_sessions', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('refuses a mutation with no kind, rather than guessing one (I-12)', async () => {
    // `jsonb_typeof(NULL) <> 'string'` is NULL, and `IF` treats NULL as false: a payload with no
    // kind passed the check with the kind still NULL and fell through to the last branch, so a
    // mutation naming nothing was handled as a `complete_session`.
    await reset();
    for (const mutation of [{}, { kind: 42 }, { kind: null }]) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: mutation,
      });
      expect(outcome.status, JSON.stringify(mutation)).toBe(400);
      expect(
        (outcome.body as { message?: string })?.message ?? '',
        JSON.stringify(mutation),
      ).toMatch(/kind/);
    }
  });

  it('refuses a missing field rather than letting a constraint catch it (I-12)', async () => {
    // `->> 'x'` is NULL for a missing field, and `NULL !~ '...'` is NULL, which `IF` treats as
    // false - so the old validation passed a session with no start time straight through to a
    // NOT NULL constraint, reported as a server error rather than a refusal.
    await reset();
    for (const missing of ['id', 'planId', 'scheduledSessionId', 'startedAt']) {
      const session = aStartSession(SESSION).session as Record<string, unknown>;
      delete session[missing];
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: { kind: 'start_session', session },
      });
      expect(outcome.status, `a session with no ${missing}`).toBe(400);
    }
  });

  it('refuses a time that is not an instant with a zone (I-12)', async () => {
    await reset();
    for (const startedAt of ['2026-09-19', 'yesterday', '2026-09-19 10:00:00', 1_758_000_000, {}]) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: aStartSession(SESSION, { startedAt }),
      });
      expect(outcome.status, JSON.stringify(startedAt)).toBeGreaterThanOrEqual(400);
    }
  });

  it('refuses a measurement the domain could not have produced (I-13)', async () => {
    await reset();
    await startASession();

    for (const measurement of [
      { schemaVersion: 1, profile: 'not_a_profile', repetitions: 8 },
      { schemaVersion: 1, profile: 'strength', repetitions: -3 },
      // A string where the domain requires a number: `->>` made these indistinguishable.
      { schemaVersion: 1, profile: 'strength', repetitions: '8' },
      { schemaVersion: 1, profile: 'strength', repetitions: 8.5 },
      { schemaVersion: 1, profile: 'strength' },
      { schemaVersion: '1', profile: 'strength', repetitions: 8 },
      { schemaVersion: 2, profile: 'strength', repetitions: 8 },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, load: { unit: 'lb', value: 40 } },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, load: { unit: 'kg', value: '40' } },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, load: { unit: 'kg' } },
      // Cardio with no duration at all, which the old check let through.
      { schemaVersion: 1, profile: 'cardio' },
      { schemaVersion: 1, profile: 'cardio', duration: { unit: 's', value: -1 } },
      { schemaVersion: 1, profile: 'cardio', duration: { unit: 'minutes', value: 20 } },
      {
        schemaVersion: 1,
        profile: 'unilateral_strength',
        repetitions: 8,
        side: 'either',
        loadSemantics: 'per_side',
      },
      { schemaVersion: 1, profile: 'unilateral_strength', repetitions: 8, side: 'left' },
      'not-an-object',
      // The rest of the contract packages/contracts validates on the wire, which the database
      // walked past before storing the JSON: bounds per unit, closed key sets, notes, exertion
      // and incline (ADR-0012, I-13).
      { schemaVersion: 1, profile: 'strength', repetitions: 8, load: { unit: 'kg', value: 1001 } },
      {
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        load: { unit: 'kg', value: 80, estimated: true },
      },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, notes: 'x'.repeat(2001) },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, notes: 12 },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, restSeconds: 90 },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, side: 'left' },
      {
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        exertion: { profile: 'cardio', borg: 12 },
      },
      {
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 11 },
          rpe: { kind: 'rpe_derived', value: 1 },
        },
      },
      {
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2.25 },
          rpe: { kind: 'rpe_derived', value: 8 },
        },
      },
      {
        // RPE is derived from RIR, so a record that disagrees asserts two different efforts.
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2 },
          rpe: { kind: 'rpe_derived', value: 1 },
        },
      },
      {
        schemaVersion: 1,
        profile: 'cardio',
        duration: { unit: 's', value: 600 },
        exertion: { profile: 'cardio', borg: 21 },
      },
      {
        schemaVersion: 1,
        profile: 'cardio',
        duration: { unit: 's', value: 600 },
        exertion: { profile: 'cardio', borg: 12.5 },
      },
      {
        schemaVersion: 1,
        profile: 'cardio',
        duration: { unit: 's', value: 600 },
        inclinePercent: 41,
      },
      {
        schemaVersion: 1,
        profile: 'cardio',
        duration: { unit: 's', value: 600 },
        inclinePercent: '10',
      },
      { schemaVersion: 1, profile: 'cardio', duration: { unit: 's', value: 86_401 } },
    ]) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: aRecordSet({ measurement }),
      });
      expect(outcome.status, JSON.stringify(measurement)).toBeGreaterThanOrEqual(400);
    }
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('accepts every measurement profile the domain models (I-13)', async () => {
    // The control. A validator that refuses everything would pass every case above.
    await reset();
    await startASession();

    const valid = [
      { schemaVersion: 1, profile: 'strength', repetitions: 8 },
      { schemaVersion: 1, profile: 'strength', repetitions: 8, load: { unit: 'kg', value: 42.5 } },
      {
        schemaVersion: 1,
        profile: 'unilateral_strength',
        repetitions: 8,
        side: 'left',
        loadSemantics: 'per_side',
        load: { unit: 'kg', value: 20 },
      },
      { schemaVersion: 1, profile: 'cardio', duration: { unit: 's', value: 1200 } },
      {
        schemaVersion: 1,
        profile: 'cardio',
        duration: { unit: 's', value: 1200 },
        distance: { unit: 'm', value: 3000 },
      },
      // Every optional field of the contract, at the edges it permits.
      {
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        notes: 'x'.repeat(2000),
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 2.5 },
          rpe: { kind: 'rpe_derived', value: 7.5 },
        },
      },
      {
        schemaVersion: 1,
        profile: 'strength',
        repetitions: 8,
        exertion: {
          profile: 'strength',
          rir: { kind: 'rir', value: 9.5 },
          rpe: { kind: 'rpe_derived', value: 1 },
        },
      },
      {
        schemaVersion: 1,
        profile: 'cardio',
        duration: { unit: 's', value: 600 },
        inclinePercent: -20,
        exertion: { profile: 'cardio', borg: 6 },
      },
    ];
    for (const [index, measurement] of valid.entries()) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: aRecordSet({ setId: `set-ok-${index}`, measurement }),
      });
      expect(outcome.status, JSON.stringify(measurement)).toBe(200);
    }
  });

  it('refuses a set for an exercise the session does not prescribe (I-15)', async () => {
    await reset();
    await startASession();

    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({ exerciseId: 'bench-press' }),
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('refuses combined load the plan never permitted, and allows it where it did (I-16)', async () => {
    await reset();
    await startASession();
    const combinedLoad = {
      schemaVersion: 1,
      profile: 'unilateral_strength',
      side: 'both',
      loadSemantics: 'total',
      repetitions: 10,
      load: { unit: 'kg', value: 22.5 },
    };

    const refused = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({ exerciseId: EXERCISE.perSide, measurement: combinedLoad }),
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);

    const permitted = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({
        setId: 'set-combined',
        exerciseId: EXERCISE.combined,
        measurement: combinedLoad,
      }),
    });
    expect(permitted.status, JSON.stringify(permitted.body)).toBe(200);
  });

  it('refuses a set recorded before its session started (I-17)', async () => {
    await reset();
    await startASession();

    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({ recordedAt: at(-90) }),
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('counts a set’s sequence itself, and refuses a claim that disagrees (I-18)', async () => {
    await reset();
    await startASession();

    for (const setId of ['set-a', 'set-b', 'set-c']) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: aKey(),
        p_mutation: aRecordSet({ setId }),
      });
      expect(outcome.status, setId).toBe(200);
    }
    const sets = await select<{ set_id: string; sequence: number }>(
      rest,
      'recorded_sets',
      `user_id=eq.${user.id}&order=sequence`,
    );
    expect(sets.map((set) => [set.set_id, set.sequence])).toEqual([
      ['set-a', 1],
      ['set-b', 2],
      ['set-c', 3],
    ]);

    // A caller that renumbers its sets is refused rather than quietly corrected.
    const renumbered = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({ setId: 'set-d', sequence: 1 }),
    });
    expect(renumbered.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to record a set into a session that is finished (I-19)', async () => {
    await reset();
    await startASession();
    const completed = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: { kind: 'complete_session', sessionId: SESSION, completedAt: at(-5) },
    });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);

    const late = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({ setId: 'set-late' }),
    });
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('refuses a session that would complete before it started (I-20)', async () => {
    await reset();
    await startASession();

    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: { kind: 'complete_session', sessionId: SESSION, completedAt: at(-120) },
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);

    const sessions = await select<{ status: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}&select=status`,
    );
    expect(sessions[0]?.status).toBe('active');
  });

  it('snapshots the plan’s names into the session, and refuses a payload that disagrees (I-28)', async () => {
    await reset({ plan: false });
    await upsert(rest, 'plans', [
      aPlanRow(user.id, {
        id: PLAN,
        revision: 5,
        name: 'Upper / lower',
        sessions: [
          {
            ...SCHEDULED_SESSION,
            name: 'Lower A',
            exercises: [
              { ...SCHEDULED_SESSION.exercises[0], name: 'Split squat', restSeconds: 150 },
            ],
          },
        ],
      }),
    ]);

    const disagreeing = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aStartSession('workout-named', { name: 'Somebody else’s name' }),
    });
    expect(disagreeing.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'workout_sessions', `user_id=eq.${user.id}`)).toEqual([]);

    const started = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aStartSession('workout-named'),
    });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const sessions = await select<{ name: string; exercise_names: Record<string, string> }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}&select=name,exercise_names`,
    );
    expect(sessions).toEqual([
      { name: 'Lower A', exercise_names: { [EXERCISE.perSide]: 'Split squat' } },
    ]);
  });

  describe('editing, deleting and restoring a set', () => {
    const aRepetitions = (repetitions: number) => ({ ...A_MEASUREMENT, repetitions });
    const aChange = (kind: string, setId: string, extra: Record<string, unknown> = {}) => ({
      kind,
      sessionId: SESSION,
      setId,
      ...extra,
    });
    const setRows = () =>
      select<{
        set_id: string;
        sequence: number;
        measurement: { repetitions: number };
        edited_at: string | null;
        deleted_at: string | null;
      }>(
        rest,
        'recorded_sets',
        `user_id=eq.${user.id}&order=sequence&select=set_id,sequence,measurement,edited_at,deleted_at`,
      );
    const apply = (mutation: unknown) =>
      callAsUser('apply_workout_mutation', { p_key: aKey(), p_mutation: mutation });

    async function withTwoSets(): Promise<void> {
      await reset();
      await startASession();
      for (const setId of ['set-1', 'set-2']) {
        expect((await apply(aRecordSet({ setId }))).status).toBe(200);
      }
    }

    it('changes only the result and when it was edited (I-26)', async () => {
      await withTwoSets();
      const edit = aChange('edit_set', 'set-1', {
        editedAt: at(-10),
        measurement: aRepetitions(12),
      });
      expect((await apply(edit)).status).toBe(200);

      const [first, second] = await setRows();
      expect(first).toMatchObject({ set_id: 'set-1', sequence: 1, deleted_at: null });
      expect(first?.measurement.repetitions).toBe(12);
      expect(first?.edited_at).not.toBeNull();
      expect(second?.measurement.repetitions).toBe(A_MEASUREMENT.repetitions);
    });

    it('holds an edit to the measurement contract, the profile and the combined-load rule (I-13, I-16, I-26)', async () => {
      await withTwoSets();
      const invalid = await apply(
        aChange('edit_set', 'set-1', { editedAt: at(-10), measurement: aRepetitions(0) }),
      );
      const otherProfile = await apply(
        aChange('edit_set', 'set-1', {
          editedAt: at(-10),
          measurement: { schemaVersion: 1, profile: 'cardio', duration: { value: 60, unit: 's' } },
        }),
      );
      expect(
        (
          await apply(
            aRecordSet({
              setId: 'set-side',
              measurement: {
                schemaVersion: 1,
                profile: 'unilateral_strength',
                side: 'left',
                loadSemantics: 'per_side',
                repetitions: 8,
                load: { unit: 'kg', value: 20 },
              },
            }),
          )
        ).status,
      ).toBe(200);
      const combined = await apply(
        aChange('edit_set', 'set-side', {
          editedAt: at(-10),
          measurement: {
            schemaVersion: 1,
            profile: 'unilateral_strength',
            side: 'left',
            loadSemantics: 'total',
            repetitions: 8,
            load: { unit: 'kg', value: 40 },
          },
        }),
      );
      for (const outcome of [invalid, otherProfile, combined]) {
        expect(outcome.status).toBeGreaterThanOrEqual(400);
      }
      expect((await setRows())[0]?.measurement.repetitions).toBe(A_MEASUREMENT.repetitions);
    });

    it('deletes as a tombstone that keeps its sequence, and restores it (I-27)', async () => {
      await withTwoSets();
      expect((await apply(aChange('delete_set', 'set-1', { deletedAt: at(-10) }))).status).toBe(
        200,
      );
      expect((await setRows()).map((row) => [row.set_id, row.deleted_at !== null])).toEqual([
        ['set-1', true],
        ['set-2', false],
      ]);

      // The next set counts past the tombstone, so sequences stay unique.
      expect((await apply(aRecordSet({ setId: 'set-3' }))).status).toBe(200);
      expect((await setRows()).map((row) => row.sequence)).toEqual([1, 2, 3]);

      expect((await apply(aChange('restore_set', 'set-1'))).status).toBe(200);
      expect((await setRows()).every((row) => row.deleted_at === null)).toBe(true);
    });

    it('refuses to restore a live set, to delete or edit a deleted one, and to touch a missing one (I-27)', async () => {
      await withTwoSets();
      const notDeleted = await apply(aChange('restore_set', 'set-1'));
      expect(notDeleted.status).toBeGreaterThanOrEqual(400);

      await apply(aChange('delete_set', 'set-1', { deletedAt: at(-10) }));
      for (const mutation of [
        aChange('delete_set', 'set-1', { deletedAt: at(-9) }),
        aChange('edit_set', 'set-1', { editedAt: at(-9), measurement: aRepetitions(9) }),
        aChange('delete_set', 'nope', { deletedAt: at(-9) }),
      ]) {
        expect((await apply(mutation)).status).toBeGreaterThanOrEqual(400);
      }
    });

    it('refuses a change stamped before the set was recorded (I-29)', async () => {
      await withTwoSets();
      const early = await apply(aChange('delete_set', 'set-1', { deletedAt: at(-25) }));
      expect(early.status).toBeGreaterThanOrEqual(400);
      expect((await setRows())[0]?.deleted_at).toBeNull();
    });

    it('is final once the session is finished (I-19)', async () => {
      await withTwoSets();
      await apply({ kind: 'complete_session', sessionId: SESSION, completedAt: at(-5) });
      for (const mutation of [
        aChange('delete_set', 'set-1', { deletedAt: at(-4) }),
        aChange('edit_set', 'set-1', { editedAt: at(-4), measurement: aRepetitions(9) }),
      ]) {
        expect((await apply(mutation)).status).toBeGreaterThanOrEqual(400);
      }
      expect((await setRows()).every((row) => row.deleted_at === null)).toBe(true);
    });

    it('replays a delete as the same fact, never as a second one (I-22)', async () => {
      await withTwoSets();
      const key = aKey();
      const mutation = aChange('delete_set', 'set-1', { deletedAt: at(-10) });
      const first = await callAsUser('apply_workout_mutation', {
        p_key: key,
        p_mutation: mutation,
      });
      const replay = await callAsUser('apply_workout_mutation', {
        p_key: key,
        p_mutation: mutation,
      });
      expect(first.body).toMatchObject({ kind: 'applied' });
      expect(replay.body).toMatchObject({ kind: 'replayed' });
    });
  });

  it('keeps the key and the mutation together, or neither (I-21)', async () => {
    await reset();
    const key = aKey();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: key,
      p_mutation: { kind: 'complete_session', sessionId: 'nonexistent', completedAt: at(0) },
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(
      await select(rest, 'idempotency_records', `user_id=eq.${user.id}&key=eq.${key}`),
      'the key outlived the failed mutation',
    ).toEqual([]);
  });

  it('cannot act for another user (I-1)', async () => {
    await reset();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_user_id: '00000000-0000-4000-8000-000000000000',
      p_key: KEY,
      p_mutation: aStartSession(SESSION),
    });
    // Either the argument does not exist, or it is ignored and the row is the caller's.
    if (outcome.status === 200) {
      const rows = await select<{ user_id: string }>(
        rest,
        'workout_sessions',
        `id=eq.${SESSION}&select=user_id`,
      );
      expect(rows.every((row) => row.user_id === user.id)).toBe(true);
    } else {
      expect(outcome.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('deciding a proposal as the signed-in user', () => {
  const PROPOSAL = 'prop-rpc-1';

  async function seedProposal(
    overrides: Record<string, unknown> = {},
    options: { plan?: boolean } = {},
  ): Promise<void> {
    await reset(options);
    await upsert(rest, 'proposals', [
      aProposalRow(user.id, { id: PROPOSAL, baseRevision: 5, ...overrides }),
    ]);
  }

  const statusOf = async (): Promise<string | undefined> =>
    (
      await select<{ status: string }>(
        rest,
        'proposals',
        `user_id=eq.${user.id}&id=eq.${PROPOSAL}&select=status`,
      )
    )[0]?.status;

  it('accepts a proposal whose stored base revision matches the plan (I-6, I-7)', async () => {
    await seedProposal();
    const outcome = await callAsUser('accept_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body).toMatchObject({ kind: 'committed', revision: 6 });
    expect(await statusOf()).toBe('accepted');
  });

  it('refuses an acceptance whose stored base revision has moved (I-6)', async () => {
    await seedProposal({ base_revision: 4 });
    const outcome = await callAsUser('accept_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });

    expect(outcome.body).toMatchObject({ kind: 'revision_changed', currentRevision: 5 });
    expect(await statusOf(), 'the proposal was decided anyway').toBe('pending');
  });

  it('refuses an acceptance whose expected revision is not the plan’s (I-6)', async () => {
    // The caller's own compare-and-set, which the adapter used to drop on the floor. A wrong
    // expectation can only lose: the server answers with the revision it holds.
    await seedProposal();
    const outcome = await callAsUser('accept_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
      p_expected_revision: 4,
    });

    expect(outcome.body).toMatchObject({ kind: 'revision_changed', currentRevision: 5 });
    expect(await statusOf()).toBe('pending');
  });

  it('refuses a decision whose expected status is not the stored one (I-5)', async () => {
    await seedProposal();
    for (const name of ['accept_proposal', 'reject_proposal']) {
      const outcome = await callAsUser(name, {
        p_proposal_id: PROPOSAL,
        p_expected_status: 'accepted',
        ...(name === 'accept_proposal' ? { p_expected_revision: 5 } : {}),
      });
      expect(outcome.body, name).toMatchObject({
        kind: 'status_changed',
        currentStatus: 'pending',
      });
    }
    expect(await statusOf()).toBe('pending');
  });

  it('refuses an expected status outside the domain’s vocabulary (I-11)', async () => {
    await seedProposal();
    const outcome = await callAsUser('accept_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'whatever',
      p_expected_revision: 5,
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(await statusOf()).toBe('pending');
  });

  it('refuses a revision that is not a positive integer (I-11)', async () => {
    await seedProposal();
    for (const revision of [0, -1, 'five']) {
      const outcome = await callAsUser('accept_proposal', {
        p_proposal_id: PROPOSAL,
        p_expected_status: 'pending',
        p_expected_revision: revision,
      });
      expect(outcome.status, String(revision)).toBeGreaterThanOrEqual(400);
    }
    expect(await statusOf()).toBe('pending');
  });

  it('refuses to decide an expired proposal, either way (I-9)', async () => {
    for (const name of ['accept_proposal', 'reject_proposal']) {
      await seedProposal({ expires_at: at(-60) });
      const outcome = await callAsUser(name, {
        p_proposal_id: PROPOSAL,
        p_expected_status: 'pending',
        ...(name === 'accept_proposal' ? { p_expected_revision: 5 } : {}),
      });
      expect(outcome.body, name).toMatchObject({ kind: 'expired' });
      expect(await statusOf()).toBe('expired');
    }
  });

  it('refuses a decision on a proposal that is no longer pending (I-5)', async () => {
    await seedProposal({ status: 'rejected', decided_at: at(-30) });
    const outcome = await callAsUser('accept_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });
    expect(outcome.body).toMatchObject({ kind: 'status_changed', currentStatus: 'rejected' });
  });

  it('offers no way to name an arbitrary target status (I-5)', async () => {
    // Only the transitions the domain allows exist, one function each.
    await seedProposal();
    for (const name of ['decide_proposal', 'expire_proposal', 'set_proposal_status']) {
      const outcome = await callAsUser(name, {
        p_proposal_id: PROPOSAL,
        p_decision: 'expired',
        p_status: 'expired',
      });
      expect(outcome.status, name).toBeGreaterThanOrEqual(400);
    }
    expect(await statusOf()).toBe('pending');
  });

  it('rejects without touching the plan revision (I-8)', async () => {
    await seedProposal();
    const outcome = await callAsUser('reject_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
    });
    expect(outcome.body).toMatchObject({ kind: 'committed' });
    expect(await statusOf()).toBe('rejected');

    const plans = await select<{ revision: number }>(rest, 'plans', `user_id=eq.${user.id}`);
    expect(plans[0]?.revision, 'rejecting advanced the plan').toBe(5);
  });

  it('rejects a proposal for a user with no readable plan at all (I-8)', async () => {
    // The normative case in the agent-proposals specification: rejection is a decision about
    // the proposal's content, so it must not depend on a plan. The previous function locked the
    // active plan first and answered `not_found` when there was none.
    await seedProposal({}, { plan: false });

    const outcome = await callAsUser('reject_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
    });
    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body).toMatchObject({ kind: 'committed' });
    expect(await statusOf()).toBe('rejected');
  });

  it('marks a proposal stale for a user with no readable plan at all (I-8)', async () => {
    await seedProposal({}, { plan: false });
    const outcome = await callAsUser('mark_proposal_stale_if_pending', {
      p_proposal_id: PROPOSAL,
    });
    expect(outcome.body).toBe('marked');
    expect(await statusOf()).toBe('rejected_stale');
  });

  it('reports a proposal that is not this user’s as absent (I-1)', async () => {
    await seedProposal();
    const outcome = await callAsUser('accept_proposal', {
      p_proposal_id: 'someone-elses-proposal',
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });
    expect(outcome.body).toMatchObject({ kind: 'not_found' });
  });

  it('stamps the decision time itself (I-10)', async () => {
    // A caller-supplied timestamp is a caller-supplied history.
    await seedProposal();
    await callAsUser('accept_proposal', {
      p_proposal_id: PROPOSAL,
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });
    const proposals = await select<{ decided_at: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.${PROPOSAL}&select=decided_at`,
    );
    const decidedAt = new Date(proposals[0]?.decided_at ?? 0).getTime();
    expect(Math.abs(Date.now() - decidedAt)).toBeLessThan(5 * 60 * 1000);
  });
});

/**
 * What a signed-in user may write without going through a function: nothing (I-2).
 *
 * Every write is a decision the functions make. A caller that can `PATCH` those rows directly
 * gets all of it back, which is what these cases are for. The one that found this was the
 * proposal: rewriting a stored `base_revision` to the plan's own makes any stale proposal
 * acceptable, and the compare-and-set meant to prevent it is then comparing two numbers the
 * caller chose.
 */
describe('writing to the tables directly, as the signed-in user', () => {
  it('cannot rebase a stale proposal to make it acceptable (I-2)', async () => {
    await reset();
    // The plan is at 5; the proposal was computed against 3, so it is stale (D-018).
    await upsert(rest, 'proposals', [
      aProposalRow(user.id, { id: 'prop-direct', baseRevision: 3 }),
    ]);

    const rebase = await writeAsUser('PATCH', 'proposals?id=eq.prop-direct', { base_revision: 5 });
    expect([401, 403], 'the stored base revision is the caller’s to choose').toContain(rebase);

    const decision = await callAsUser('accept_proposal', {
      p_proposal_id: 'prop-direct',
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });
    expect(decision.body).toEqual({ kind: 'revision_changed', currentRevision: 5 });
  });

  it('cannot decide a proposal by writing its status (I-2)', async () => {
    await reset();
    await upsert(rest, 'proposals', [
      aProposalRow(user.id, { id: 'prop-direct', baseRevision: 3 }),
    ]);

    expect([401, 403]).toContain(
      await writeAsUser('PATCH', 'proposals?id=eq.prop-direct', {
        status: 'accepted',
        decided_at: at(0),
      }),
    );
    const rows = await select<{ status: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.prop-direct&select=status`,
    );
    expect(rows[0]?.status, 'a decision was taken outside the function').toBe('pending');
  });

  it('cannot delete an idempotency record to replay a mutation it already sent (I-2)', async () => {
    await reset();
    await startASession();

    // Deleting the record is how a client would turn a replay back into a fresh application,
    // which is the duplicate the outbox exists to prevent.
    expect([401, 403]).toContain(await writeAsUser('DELETE', `idempotency_records?key=eq.${KEY}`));
    const keys = await select<{ key: string }>(
      rest,
      'idempotency_records',
      `user_id=eq.${user.id}`,
    );
    expect(keys, 'the record the replay check depends on was removable').toHaveLength(1);
  });

  it('cannot forge a replay by claiming a key with a result of its own (I-2)', async () => {
    await reset();
    expect([401, 403]).toContain(
      await writeAsUser('POST', 'idempotency_records', {
        user_id: user.id,
        key: KEY,
        request_fingerprint: 'forged',
        result: { sessionId: 'never-happened' },
        mutation: { kind: 'start_session' },
      }),
    );
  });

  it('cannot reopen or edit a completed session directly (I-2, I-19)', async () => {
    await reset();
    await startASession();
    await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: { kind: 'complete_session', sessionId: SESSION, completedAt: at(-5) },
    });

    expect([401, 403]).toContain(
      await writeAsUser('PATCH', `workout_sessions?id=eq.${SESSION}`, {
        status: 'active',
        completed_at: null,
        facts_revision: null,
      }),
    );
    const sessions = await select<{ status: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}&select=status`,
    );
    expect(sessions[0]?.status).toBe('completed');
  });

  it('cannot alter a correction, which records what a value was (I-2, I-19)', async () => {
    await reset();
    await startASession();
    await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aRecordSet({ setId: 'set-1' }),
    });
    await upsert(rest, 'session_corrections', [
      {
        user_id: user.id,
        session_id: SESSION,
        revision: 1,
        set_id: 'set-1',
        previous: { repetitions: 8 },
        corrected: { repetitions: 9 },
        actor_kind: 'user',
        actor_id: user.id,
        corrected_at: at(-1),
      },
    ]);

    expect([401, 403]).toContain(
      await writeAsUser('PATCH', `session_corrections?session_id=eq.${SESSION}`, {
        previous: { repetitions: 1 },
      }),
    );
    expect([401, 403]).toContain(
      await writeAsUser('DELETE', `session_corrections?session_id=eq.${SESSION}`),
    );

    const corrections = await select<{ previous: { repetitions: number } }>(
      rest,
      'session_corrections',
      `user_id=eq.${user.id}&select=previous`,
    );
    expect(corrections[0]?.previous).toEqual({ repetitions: 8 });
  });

  it('cannot execute any function the boundary calls (I-4)', async () => {
    // Derived from the migrations rather than written down here: a list is how the five helpers
    // migration 20260919170000 added ended up audited by nobody. Anything this repository
    // defines in `public` that is not one of the four a client calls must be unreachable.
    await reset();
    const helpers = helperFunctionsInMigrations();

    // Coverage first, so this case cannot quietly stop covering something.
    expect(helpers).toEqual(expect.arrayContaining(['json_has_only', 'json_is_notes']));
    expect(helpers).toEqual(
      expect.arrayContaining([
        'json_is_strength_exertion',
        'json_is_cardio_exertion',
        'json_is_incline',
      ]),
    );
    expect(helpers.length).toBeGreaterThanOrEqual(11);

    // Called with the arguments each one really takes, so a refusal is about privilege and not
    // about a signature that never matched. The control below shows a call with the right
    // arguments does reach a function the role may execute.
    const argumentsFor = (helper: string): Record<string, unknown> => {
      if (helper === 'is_valid_measurement') return { p_measurement: A_MEASUREMENT };
      if (helper === 'json_is_quantity') return { p: { unit: 'kg', value: 1 }, p_unit: 'kg' };
      if (helper === 'json_has_only') return { p: {}, p_keys: ['unit'] };
      return { p: A_MEASUREMENT };
    };

    for (const helper of helpers) {
      const args = argumentsFor(helper);
      const outcome = await callAsUser(helper, args);
      expect(outcome.status, helper).toBeGreaterThanOrEqual(400);
      expect(
        JSON.stringify(outcome.body ?? ''),
        `${helper} answered rather than refusing`,
      ).not.toMatch(/^(true|false)$/);

      // The same arguments, as a role that does hold EXECUTE. Without this the refusal above
      // could be a signature that never matched rather than a privilege that is not there -
      // PostgREST answers 404 for both.
      const asServiceRole = await fetch(`${server.url}/rest/v1/rpc/${helper}`, {
        method: 'POST',
        headers: { ...admin, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      expect(asServiceRole.status, `${helper} was called with arguments it does not take`).toBe(
        200,
      );
    }

    // The control: the same mechanism, on a function this role may execute.
    const permitted = await callAsUser('apply_workout_mutation', {
      p_key: aKey(),
      p_mutation: aStartSession(SESSION),
    });
    expect(permitted.status, JSON.stringify(permitted.body)).toBe(200);
  });

  it('can still read everything of its own, which is what the app needs (I-3)', async () => {
    // The control. Without it the refusals above could be a role that cannot do anything.
    await reset();
    for (const table of ['plans', 'workout_sessions', 'proposals', 'idempotency_records']) {
      const response = await fetch(
        `${server.url}/rest/v1/${table}?user_id=eq.${user.id}&select=user_id`,
        { headers: { apikey: server.publishableKey, Authorization: `Bearer ${user.accessToken}` } },
      );
      expect(response.status, table).toBe(200);
    }
  });
});
