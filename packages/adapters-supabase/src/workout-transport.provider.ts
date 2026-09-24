import { beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { rpc, select, upsert } from './rest.js';
import { A_MEASUREMENT, aPlanRow, at, EXERCISE, SCHEDULED_SESSION_ID } from './test-fixtures.js';
import { signInDevelopmentUser } from './test-identity.js';
import { SupabaseWorkoutTransport } from './workout-transport.js';

/**
 * Idempotent replay, against the real development database (tasks 2.6 and 4.3).
 *
 * `.provider.ts`, so `pnpm verify` never runs it. Every assertion here is about what the
 * database did, read back after the fact rather than inferred from a return value.
 *
 * The transport sends as a signed-in user, because that is the only role the application ever
 * has. The service role is used to set up and to read back, never to make the call under test:
 * it bypasses row-level security and every grant, so it would hide exactly the failures these
 * assertions are for.
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

const EMAIL = 'transport-user@workout-logger.invalid';
let userId = '';
/** The user's own REST credentials, for the one assertion that calls the function directly. */
let asUser = { url: server.url, key: server.publishableKey, accessToken: '' };
let transport: SupabaseWorkoutTransport;

/** Empties this user's rows and seeds the plan a session has to belong to. */
async function reset(): Promise<void> {
  for (const table of ['recorded_sets', 'idempotency_records', 'workout_sessions', 'plans']) {
    await fetch(`${server.url}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: admin,
    });
  }
  await upsert(rest, 'plans', [aPlanRow(userId, { id: 'plan-transport', revision: 1 })]);
}

/**
 * What a device delivers: which plan, which scheduled session, when it started. The revision,
 * the prescribed exercises and the combined-load permission are the plan's, derived by the
 * server (ADR-0012, I-14).
 */
const startSession = (id: string) => ({
  kind: 'start_session',
  session: {
    id,
    planId: 'plan-transport',
    scheduledSessionId: SCHEDULED_SESSION_ID,
    startedAt: at(-30),
  },
});

const KEY = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  const signedIn = await signInDevelopmentUser(server, EMAIL);
  userId = signedIn.id;
  asUser = { url: server.url, key: server.publishableKey, accessToken: signedIn.accessToken };
  transport = new SupabaseWorkoutTransport(server, signedIn.accessToken);
}, 60_000);

describe('delivering a mutation to the server', () => {
  it('applies it once and records the key in the same transaction', async () => {
    await reset();
    const mutation = startSession('workout-1');

    expect(await transport.send({ idempotencyKey: KEY, mutation })).toEqual({
      kind: 'response',
      status: 200,
    });

    // Read back: the session is there, and so is the key that named it.
    const sessions = await select<{ id: string }>(rest, 'workout_sessions', `user_id=eq.${userId}`);
    expect(sessions.map((session) => session.id)).toEqual(['workout-1']);
    const keys = await select<{ key: string }>(rest, 'idempotency_records', `user_id=eq.${userId}`);
    expect(keys.map((record) => record.key)).toEqual([KEY]);
  });

  it('returns the original result on replay, with no duplicate row', async () => {
    await reset();
    const mutation = startSession('workout-1');

    await transport.send({ idempotencyKey: KEY, mutation });
    const replay = await transport.send({ idempotencyKey: KEY, mutation });

    // A replay is a success, which is what makes a retry safe.
    expect(replay).toEqual({ kind: 'response', status: 200 });
    const sessions = await select<{ id: string }>(rest, 'workout_sessions', `user_id=eq.${userId}`);
    expect(sessions, 'the replay created a second row').toHaveLength(1);

    // The transport reports a replay as a plain success, so the distinction is only visible
    // in the function's own answer. Called as the user, which is the only way it is callable.
    const raw = await rpc<{ kind: string; result: { sessionId: string } }>(
      asUser,
      'apply_workout_mutation',
      { p_key: KEY, p_mutation: mutation },
    );
    expect(raw.kind).toBe('replayed');
    expect(raw.result).toEqual({ sessionId: 'workout-1' });
  });

  it('refuses a key reused for a different payload (task 4.3)', async () => {
    await reset();
    await transport.send({ idempotencyKey: KEY, mutation: startSession('workout-1') });
    const reused = await transport.send({
      idempotencyKey: KEY,
      mutation: startSession('workout-2'),
    });

    // 409: a permanent failure needing a person, never a retry.
    expect(reused).toEqual({ kind: 'response', status: 409 });
    const sessions = await select<{ id: string }>(rest, 'workout_sessions', `user_id=eq.${userId}`);
    expect(
      sessions.map((session) => session.id),
      'the second payload was applied',
    ).toEqual(['workout-1']);
  });

  it('commits the key and the mutation together, or neither', async () => {
    // The mutation fails: completing a session that is not there. The key must not survive it,
    // or the client could never deliver that change at all.
    await reset();
    const outcome = await transport.send({
      idempotencyKey: KEY,
      mutation: {
        kind: 'complete_session',
        sessionId: 'nonexistent',
        completedAt: at(-5),
      },
    });
    expect(outcome.kind === 'response' && outcome.status).toBeGreaterThanOrEqual(400);

    const keys = await select<{ key: string }>(rest, 'idempotency_records', `user_id=eq.${userId}`);
    expect(keys, 'the key outlived the failed mutation').toEqual([]);
  });

  it('records a set and completes the session it belongs to', async () => {
    await reset();
    await transport.send({ idempotencyKey: KEY, mutation: startSession('workout-1') });

    await transport.send({
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      mutation: {
        kind: 'record_set',
        sessionId: 'workout-1',
        set: {
          setId: 'set-1',
          exerciseId: EXERCISE.perSide,
          measurement: A_MEASUREMENT,
          recordedAt: at(-20),
        },
      },
    });
    await transport.send({
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      mutation: {
        kind: 'complete_session',
        sessionId: 'workout-1',
        completedAt: at(-5),
      },
    });

    const sets = await select<{ set_id: string }>(rest, 'recorded_sets', `user_id=eq.${userId}`);
    expect(sets.map((set) => set.set_id)).toEqual(['set-1']);
    const sessions = await select<{ status: string; facts_revision: number }>(
      rest,
      'workout_sessions',
      `user_id=eq.${userId}`,
    );
    expect(sessions[0]?.status).toBe('completed');
    expect(sessions[0]?.facts_revision).toBe(1);
  });
});
