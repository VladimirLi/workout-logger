import { beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { select, upsert } from './rest.js';
import { signInDevelopmentUser } from './test-identity.js';

/**
 * The functions as a signed-in user actually calls them (review findings 1-4).
 *
 * Every earlier provider test called them with the service role, which bypasses row-level
 * security and every table grant. That made the suite blind to the case that matters: the
 * browser calls these as `authenticated`, with only the privileges that role has.
 *
 * These are the cases a caller could otherwise get away with. Each one is a claim about what
 * the server refuses, so each is written against a user token and never the service role.
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

let user: { id: string; accessToken: string };

/** An RPC call as the signed-in user: their token, the anonymous key, exactly like a browser. */
async function callAsUser(
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${server.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: server.anonKey,
      Authorization: `Bearer ${user.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

async function reset(): Promise<void> {
  for (const table of [
    'recorded_sets',
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
  await upsert(rest, 'plans', [
    {
      user_id: user.id,
      id: 'plan-rpc',
      revision: 5,
      status: 'active',
      activated_at: '2026-09-19T00:00:00Z',
      sessions: [],
    },
  ]);
}

const aSession = (id: string) => ({
  kind: 'start_session',
  session: {
    id,
    planId: 'plan-rpc',
    planRevision: 5,
    scheduledSessionId: 'session-mon',
    exerciseIds: ['split-squat'],
    combinedLoadExercises: [],
    startedAt: '2026-09-19T10:00:00Z',
    status: 'active',
    sets: [],
  },
});

const KEY = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

beforeAll(async () => {
  user = await signInDevelopmentUser(server, 'rpc-user@workout-logger.invalid');
}, 120_000);

describe('applying a mutation as the signed-in user', () => {
  it('succeeds with only the privileges that role has', async () => {
    // Finding 3: the function updated idempotency_records, on which `authenticated` has
    // SELECT and INSERT and no UPDATE. Under the service role that is invisible.
    await reset();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: KEY,
      p_mutation: aSession('workout-1'),
    });

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body).toMatchObject({ kind: 'applied' });

    const sessions = await select<{ id: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}`,
    );
    expect(sessions.map((session) => session.id)).toEqual(['workout-1']);
  });

  it('detects a different payload under the same key without trusting the caller', async () => {
    // Finding 2: the fingerprint was a parameter, so a client could send a different payload
    // with the first one's fingerprint and have it accepted as a replay - silently dropping
    // the change it actually asked for.
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });

    const conflicting = await callAsUser('apply_workout_mutation', {
      p_key: KEY,
      p_mutation: aSession('workout-2'),
    });
    expect(conflicting.body).toMatchObject({ kind: 'key_reused' });

    const sessions = await select<{ id: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}`,
    );
    expect(sessions.map((session) => session.id)).toEqual(['workout-1']);
  });

  it('replays the identical payload', async () => {
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });
    const replay = await callAsUser('apply_workout_mutation', {
      p_key: KEY,
      p_mutation: aSession('workout-1'),
    });
    expect(replay.body).toMatchObject({ kind: 'replayed' });
  });

  it('refuses a mutation it cannot recognise', async () => {
    // Finding 4: the function took unvalidated jsonb from a role a browser holds.
    await reset();
    for (const mutation of [
      { kind: 'drop_everything' },
      { kind: 'start_session' },
      { kind: 'start_session', session: { id: 'x' } },
    ]) {
      const outcome = await callAsUser('apply_workout_mutation', {
        p_key: `bbbbbbbb-1111-4111-8111-${String(Math.random()).slice(2, 14)}`,
        p_mutation: mutation,
      });
      expect(outcome.status, JSON.stringify(mutation)).toBeGreaterThanOrEqual(400);
    }
    expect(await select(rest, 'workout_sessions', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('refuses a measurement the domain could not have produced', async () => {
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });

    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: 'cccccccc-1111-4111-8111-cccccccccccc',
      p_mutation: {
        kind: 'record_set',
        sessionId: 'workout-1',
        set: {
          setId: 'set-1',
          exerciseId: 'split-squat',
          sequence: 1,
          measurement: { schemaVersion: 1, profile: 'not_a_profile', repetitions: -3 },
          recordedAt: '2026-09-19T10:05:00Z',
        },
      },
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('refuses combined load the plan never permitted', async () => {
    // The domain refuses it; so must the server, or a client can bypass the rule entirely.
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });

    const outcome = await callAsUser('apply_workout_mutation', {
      p_key: 'dddddddd-1111-4111-8111-dddddddddddd',
      p_mutation: {
        kind: 'record_set',
        sessionId: 'workout-1',
        set: {
          setId: 'set-1',
          exerciseId: 'split-squat',
          sequence: 1,
          measurement: {
            schemaVersion: 1,
            profile: 'unilateral_strength',
            side: 'left',
            loadSemantics: 'total',
            repetitions: 10,
            load: { unit: 'kg', value: 22.5 },
          },
          recordedAt: '2026-09-19T10:05:00Z',
        },
      },
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('refuses to record a set into a session that is finished', async () => {
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });
    await callAsUser('apply_workout_mutation', {
      p_key: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee',
      p_mutation: {
        kind: 'complete_session',
        sessionId: 'workout-1',
        completedAt: '2026-09-19T11:00:00Z',
      },
    });

    const late = await callAsUser('apply_workout_mutation', {
      p_key: 'ffffffff-1111-4111-8111-ffffffffffff',
      p_mutation: {
        kind: 'record_set',
        sessionId: 'workout-1',
        set: {
          setId: 'set-late',
          exerciseId: 'split-squat',
          sequence: 1,
          measurement: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
          recordedAt: '2026-09-19T11:05:00Z',
        },
      },
    });
    expect(late.status).toBeGreaterThanOrEqual(400);
    expect(await select(rest, 'recorded_sets', `user_id=eq.${user.id}`)).toEqual([]);
  });

  it('cannot act for another user', async () => {
    // The user is taken from the token, never from an argument.
    await reset();
    const outcome = await callAsUser('apply_workout_mutation', {
      p_user_id: '00000000-0000-4000-8000-000000000000',
      p_key: KEY,
      p_mutation: aSession('workout-1'),
    });
    // Either the argument does not exist, or it is ignored and the row is the caller's.
    if (outcome.status === 200) {
      const rows = await select<{ user_id: string }>(
        rest,
        'workout_sessions',
        `id=eq.workout-1&select=user_id`,
      );
      expect(rows.every((row) => row.user_id === user.id)).toBe(true);
    } else {
      expect(outcome.status).toBeGreaterThanOrEqual(400);
    }
  });
});

describe('deciding a proposal as the signed-in user', () => {
  const PROPOSAL = 'prop-rpc-1';

  async function seedProposal(overrides: Record<string, unknown> = {}): Promise<void> {
    await reset();
    await upsert(rest, 'proposals', [
      {
        user_id: user.id,
        id: PROPOSAL,
        base_revision: 5,
        diff: { op: 'replace_plan', sessions: [] },
        rationale: 'because',
        status: 'pending',
        created_at: '2026-09-19T09:00:00Z',
        decided_at: null,
        actor_client_id: 'client',
        actor_agent_id: 'agent',
        input_hash: 'hash',
        expires_at: '2026-09-26T09:00:00Z',
        ...overrides,
      },
    ]);
  }

  it('accepts a proposal whose stored base revision matches the plan', async () => {
    await seedProposal();
    const outcome = await callAsUser('decide_proposal', {
      p_proposal_id: PROPOSAL,
      p_decision: 'accept',
    });

    expect(outcome.status, JSON.stringify(outcome.body)).toBe(200);
    expect(outcome.body).toMatchObject({ kind: 'committed', revision: 6 });
    const proposals = await select<{ status: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.${PROPOSAL}`,
    );
    expect(proposals[0]?.status).toBe('accepted');
  });

  it('refuses an acceptance whose stored base revision has moved', async () => {
    // Finding 1: the expected revision was a parameter, so a caller could claim the current
    // one and accept a proposal computed against a plan that no longer exists.
    await seedProposal({ base_revision: 4 });
    const outcome = await callAsUser('decide_proposal', {
      p_proposal_id: PROPOSAL,
      p_decision: 'accept',
    });

    expect(outcome.body).toMatchObject({ kind: 'revision_changed', currentRevision: 5 });
    const proposals = await select<{ status: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.${PROPOSAL}`,
    );
    expect(proposals[0]?.status, 'the proposal was decided anyway').toBe('pending');
  });

  it('refuses to accept an expired proposal', async () => {
    await seedProposal({ expires_at: '2026-09-18T09:00:00Z' });
    const outcome = await callAsUser('decide_proposal', {
      p_proposal_id: PROPOSAL,
      p_decision: 'accept',
    });
    expect(outcome.body).toMatchObject({ kind: 'expired' });
  });

  it('refuses a decision on a proposal that is no longer pending', async () => {
    await seedProposal({ status: 'rejected', decided_at: '2026-09-19T09:30:00Z' });
    const outcome = await callAsUser('decide_proposal', {
      p_proposal_id: PROPOSAL,
      p_decision: 'accept',
    });
    expect(outcome.body).toMatchObject({ kind: 'status_changed', currentStatus: 'rejected' });
  });

  it('offers no way to name an arbitrary target status', async () => {
    // Only the transitions the domain allows are reachable: accept and reject.
    await seedProposal();
    const outcome = await callAsUser('decide_proposal', {
      p_proposal_id: PROPOSAL,
      p_decision: 'expired',
    });
    expect(outcome.status).toBeGreaterThanOrEqual(400);
    const proposals = await select<{ status: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.${PROPOSAL}`,
    );
    expect(proposals[0]?.status).toBe('pending');
  });

  it('rejects without touching the plan revision', async () => {
    await seedProposal();
    const outcome = await callAsUser('decide_proposal', {
      p_proposal_id: PROPOSAL,
      p_decision: 'reject',
    });
    expect(outcome.body).toMatchObject({ kind: 'committed' });

    const plans = await select<{ revision: number }>(rest, 'plans', `user_id=eq.${user.id}`);
    expect(plans[0]?.revision, 'rejecting advanced the plan').toBe(5);
  });

  it('stamps the decision time itself', async () => {
    // A caller-supplied timestamp is a caller-supplied history.
    await seedProposal();
    await callAsUser('decide_proposal', { p_proposal_id: PROPOSAL, p_decision: 'accept' });
    const proposals = await select<{ decided_at: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.${PROPOSAL}`,
    );
    const decidedAt = new Date(proposals[0]?.decided_at ?? 0).getTime();
    expect(Math.abs(Date.now() - decidedAt)).toBeLessThan(5 * 60 * 1000);
  });
});

/**
 * What a signed-in user may write without going through a function.
 *
 * Nothing. Every write is a decision the functions make: identity, revisions, transitions,
 * timestamps and replay all come from rows the server holds under lock. A caller that can
 * `PATCH` those rows directly gets all of that back, which is why these cases exist. The one
 * that found this was the proposal: rewriting a stored `base_revision` to the plan's own makes
 * any stale proposal acceptable, and the compare-and-set that is supposed to prevent it is
 * then comparing two numbers the caller chose.
 */
describe('writing to the tables directly, as the signed-in user', () => {
  /** A write as the user, with the anonymous key, exactly like a browser. */
  async function writeAsUser(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<number> {
    const response = await fetch(`${server.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: server.anonKey,
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.status;
  }

  async function seedPendingProposal(baseRevision: number): Promise<void> {
    await upsert(rest, 'proposals', [
      {
        user_id: user.id,
        id: 'prop-direct',
        base_revision: baseRevision,
        diff: { op: 'replace_plan', sessions: [] },
        rationale: 'because',
        status: 'pending',
        created_at: '2026-09-19T00:00:00Z',
        decided_at: null,
        actor_client_id: 'client',
        actor_agent_id: 'agent',
        input_hash: 'hash',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      },
    ]);
  }

  it('cannot rebase a stale proposal to make it acceptable', async () => {
    await reset();
    // The plan is at 5; the proposal was computed against 3, so it is stale (D-018).
    await seedPendingProposal(3);

    const rebase = await writeAsUser('PATCH', `proposals?id=eq.prop-direct`, { base_revision: 5 });
    expect([401, 403], 'the stored base revision is the caller’s to choose').toContain(rebase);

    const decision = await callAsUser('decide_proposal', {
      p_proposal_id: 'prop-direct',
      p_decision: 'accept',
    });
    expect(decision.body).toEqual({ kind: 'revision_changed', currentRevision: 5 });
  });

  it('cannot decide a proposal by writing its status', async () => {
    await reset();
    await seedPendingProposal(3);

    const written = await writeAsUser('PATCH', `proposals?id=eq.prop-direct`, {
      status: 'accepted',
      decided_at: new Date().toISOString(),
    });
    expect([401, 403]).toContain(written);

    const rows = await select<{ status: string }>(
      rest,
      'proposals',
      `user_id=eq.${user.id}&id=eq.prop-direct&select=status`,
    );
    expect(rows[0]?.status, 'a decision was taken outside the function').toBe('pending');
  });

  it('cannot delete an idempotency record to replay a mutation it already sent', async () => {
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });

    // Deleting the record is how a client would turn a replay back into a fresh application,
    // which is the duplicate the outbox exists to prevent.
    const removed = await writeAsUser('DELETE', `idempotency_records?key=eq.${KEY}`);
    expect([401, 403]).toContain(removed);
    const keys = await select<{ key: string }>(
      rest,
      'idempotency_records',
      `user_id=eq.${user.id}`,
    );
    expect(keys, 'the record the replay check depends on was removable').toHaveLength(1);
  });

  it('cannot forge a replay by claiming a key with a result of its own', async () => {
    await reset();
    const forged = await writeAsUser('POST', 'idempotency_records', {
      user_id: user.id,
      key: KEY,
      request_fingerprint: 'forged',
      result: { sessionId: 'never-happened' },
      mutation: { kind: 'start_session' },
    });
    expect([401, 403]).toContain(forged);
  });

  it('cannot reopen or edit a completed session directly', async () => {
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });
    await callAsUser('apply_workout_mutation', {
      p_key: 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa',
      p_mutation: {
        kind: 'complete_session',
        sessionId: 'workout-1',
        completedAt: '2026-09-19T11:00:00Z',
      },
    });

    // A completed session is corrected by recording what a value was, never by editing it
    // (D-012). The function enforces that; a direct write would go around it.
    const reopened = await writeAsUser('PATCH', 'workout_sessions?id=eq.workout-1', {
      status: 'active',
      completed_at: null,
      facts_revision: null,
    });
    expect([401, 403]).toContain(reopened);

    const sessions = await select<{ status: string }>(
      rest,
      'workout_sessions',
      `user_id=eq.${user.id}&select=status`,
    );
    expect(sessions[0]?.status).toBe('completed');
  });

  it('cannot alter a correction, which records what a value was', async () => {
    await reset();
    await callAsUser('apply_workout_mutation', { p_key: KEY, p_mutation: aSession('workout-1') });
    await upsert(rest, 'session_corrections', [
      {
        user_id: user.id,
        session_id: 'workout-1',
        revision: 1,
        set_id: 'set-1',
        previous: { repetitions: 8 },
        corrected: { repetitions: 9 },
        actor_kind: 'user',
        actor_id: user.id,
        corrected_at: '2026-09-19T12:00:00Z',
      },
    ]);

    expect([401, 403]).toContain(
      await writeAsUser('PATCH', 'session_corrections?session_id=eq.workout-1', {
        previous: { repetitions: 1 },
      }),
    );
    expect([401, 403]).toContain(
      await writeAsUser('DELETE', 'session_corrections?session_id=eq.workout-1'),
    );

    const corrections = await select<{ previous: { repetitions: number } }>(
      rest,
      'session_corrections',
      `user_id=eq.${user.id}&select=previous`,
    );
    expect(corrections[0]?.previous).toEqual({ repetitions: 8 });
  });

  it('can still read everything of its own, which is what the app needs', async () => {
    // The control. Without it the refusals above could be a role that cannot do anything.
    await reset();
    for (const table of ['plans', 'workout_sessions', 'proposals', 'idempotency_records']) {
      const response = await fetch(
        `${server.url}/rest/v1/${table}?user_id=eq.${user.id}&select=user_id`,
        {
          headers: { apikey: server.anonKey, Authorization: `Bearer ${user.accessToken}` },
        },
      );
      expect(response.status, table).toBe(200);
    }
  });
});
