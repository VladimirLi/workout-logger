import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { rpc, select, upsert } from './rest.js';
import { SupabaseWorkoutTransport } from './workout-transport.js';

/**
 * Idempotent replay, against the real development database (tasks 2.6 and 4.3).
 *
 * `.provider.ts`, so `pnpm verify` never runs it. Every assertion here is about what the
 * database did, read back after the fact rather than inferred from a return value.
 */

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const anonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const serviceRoleKey = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!url || !anonKey || !serviceRoleKey) {
  throw new Error('the provider suite needs .env.local; run `pnpm test:provider`.');
}

const config = serverConfig({ url, anonKey, serviceRoleKey });
if (!config.ok) throw new Error(`invalid Supabase configuration: ${JSON.stringify(config.error)}`);
const server = config.value;
const rest = { url: server.url, key: server.serviceRoleKey };
const admin = { apikey: server.serviceRoleKey, Authorization: `Bearer ${server.serviceRoleKey}` };

const fingerprint = (mutation: unknown) =>
  createHash('sha256').update(JSON.stringify(mutation)).digest('hex');

const EMAIL = 'transport-user@workout-logger.invalid';
let userId = '';

async function ensureUser(): Promise<string> {
  const listed = await fetch(`${server.url}/auth/v1/admin/users?per_page=200`, { headers: admin });
  const { users } = (await listed.json()) as { users?: { id: string; email: string }[] };
  const existing = users?.find((user) => user.email === EMAIL);
  if (existing) return existing.id;
  const created = await fetch(`${server.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, email_confirm: true }),
  });
  const body = (await created.json()) as { id?: string; msg?: string };
  if (!body.id) throw new Error(`could not create the development user: ${body.msg ?? '?'}`);
  return body.id;
}

/** Empties this user's rows and seeds the plan a session has to belong to. */
async function reset(): Promise<void> {
  for (const table of ['recorded_sets', 'idempotency_records', 'workout_sessions', 'plans']) {
    await fetch(`${server.url}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: admin,
    });
  }
  await upsert(rest, 'plans', [
    {
      user_id: userId,
      id: 'plan-transport',
      revision: 1,
      status: 'active',
      activated_at: '2026-09-18T00:00:00Z',
      sessions: [],
    },
  ]);
}

const startSession = (id: string) => ({
  kind: 'start_session',
  session: {
    id,
    planId: 'plan-transport',
    planRevision: 1,
    scheduledSessionId: 'session-mon',
    exerciseIds: ['back-squat'],
    combinedLoadExercises: [],
    startedAt: '2026-09-18T10:00:00Z',
    status: 'active',
    sets: [],
  },
});

const KEY = '11111111-1111-4111-8111-111111111111';

beforeAll(async () => {
  userId = await ensureUser();
}, 60_000);

describe('delivering a mutation to the server', () => {
  it('applies it once and records the key in the same transaction', async () => {
    await reset();
    const transport = new SupabaseWorkoutTransport(server, userId, fingerprint);
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
    const transport = new SupabaseWorkoutTransport(server, userId, fingerprint);
    const mutation = startSession('workout-1');

    await transport.send({ idempotencyKey: KEY, mutation });
    const replay = await transport.send({ idempotencyKey: KEY, mutation });

    // A replay is a success, which is what makes a retry safe.
    expect(replay).toEqual({ kind: 'response', status: 200 });
    const sessions = await select<{ id: string }>(rest, 'workout_sessions', `user_id=eq.${userId}`);
    expect(sessions, 'the replay created a second row').toHaveLength(1);

    const raw = await rpc<{ kind: string; result: { sessionId: string } }>(
      rest,
      'apply_workout_mutation',
      {
        p_user_id: userId,
        p_key: KEY,
        p_fingerprint: fingerprint(mutation),
        p_mutation: mutation,
      },
    );
    expect(raw.kind).toBe('replayed');
    expect(raw.result).toEqual({ sessionId: 'workout-1' });
  });

  it('refuses a key reused for a different payload (task 4.3)', async () => {
    await reset();
    const transport = new SupabaseWorkoutTransport(server, userId, fingerprint);

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
    const transport = new SupabaseWorkoutTransport(server, userId, fingerprint);

    const outcome = await transport.send({
      idempotencyKey: KEY,
      mutation: {
        kind: 'complete_session',
        sessionId: 'nonexistent',
        completedAt: '2026-09-18T11:00:00Z',
      },
    });
    expect(outcome.kind === 'response' && outcome.status).toBeGreaterThanOrEqual(400);

    const keys = await select<{ key: string }>(rest, 'idempotency_records', `user_id=eq.${userId}`);
    expect(keys, 'the key outlived the failed mutation').toEqual([]);
  });

  it('records a set and completes the session it belongs to', async () => {
    await reset();
    const transport = new SupabaseWorkoutTransport(server, userId, fingerprint);
    await transport.send({ idempotencyKey: KEY, mutation: startSession('workout-1') });

    await transport.send({
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      mutation: {
        kind: 'record_set',
        sessionId: 'workout-1',
        set: {
          setId: 'set-1',
          exerciseId: 'back-squat',
          sequence: 1,
          measurement: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
          recordedAt: '2026-09-18T10:05:00Z',
        },
      },
    });
    await transport.send({
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      mutation: {
        kind: 'complete_session',
        sessionId: 'workout-1',
        completedAt: '2026-09-18T11:00:00Z',
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
