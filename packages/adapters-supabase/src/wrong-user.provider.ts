import { beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { upsert } from './rest.js';
import { type DevelopmentIdentity, signInDevelopmentUser } from './test-identity.js';

/**
 * Wrong-user denial, with real signed-in identities (identity spec, task 2.3; R-013).
 *
 * The anonymous half is `scripts/check-rls.mjs`. This is the other half, and it needs what
 * that one does not: two users who have actually signed in, so the requests carry their own
 * tokens and row-level security has an `auth.uid()` to compare against. Anything less tests
 * the service role, which bypasses the policies entirely and would prove nothing.
 *
 * Every exposed relation is seeded with a row that really belongs to the owner, because a
 * denial over an empty table is not a denial - the read returns `[]` whether the policy works
 * or not.
 *
 * Reads are where row-level security does the work, and they are checked on every relation.
 * Direct writes are refused to everybody since 20260919110000, so the write cases assert that
 * and read the owner's row back with the service role: a write that is silently dropped and a
 * write that succeeded look the same from the caller's side.
 *
 * That leaves the functions as the only way to write, and they are `SECURITY DEFINER`, so
 * row-level security does not protect them. What protects them is that they take their user
 * from `auth.uid()`, which the last cases exercise as the intruder.
 *
 * `.provider.ts`, so `pnpm verify` never runs it.
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

/** A request as that user: their token, and the anonymous key as the API key, like a browser. */
function asUser(identity: DevelopmentIdentity): Record<string, string> {
  return {
    apikey: server.anonKey,
    Authorization: `Bearer ${identity.accessToken}`,
    'Content-Type': 'application/json',
  };
}

let owner: DevelopmentIdentity;
let intruder: DevelopmentIdentity;

const OWNER_KEY = '44444444-4444-4444-8444-444444444444';
const FUTURE = new Date(Date.now() + 3_600_000).toISOString();

/**
 * One exposed relation, with everything the checks need: a row that is really the owner's, the
 * filter that names it, and a change to attempt along with the column it would show up in.
 */
interface Relation {
  readonly table: string;
  readonly row: Record<string, unknown>;
  /** Identifies the seeded row within the user, e.g. `id=eq.plan-rls`. */
  readonly filter: string;
  /** A change the intruder attempts, and the column it would be visible in. */
  readonly patch: Record<string, unknown>;
  readonly watched: string;
}

/** Built per user, so the same shapes can be seeded for the owner and for the intruder. */
function relationsFor(userId: string): Relation[] {
  return [
    {
      table: 'plans',
      row: {
        user_id: userId,
        id: 'plan-rls',
        revision: 1,
        status: 'active',
        activated_at: '2026-09-18T00:00:00Z',
        sessions: [],
      },
      filter: 'id=eq.plan-rls',
      patch: { revision: 99 },
      watched: 'revision',
    },
    {
      table: 'workout_sessions',
      row: {
        user_id: userId,
        id: 'session-rls',
        plan_id: 'plan-rls',
        plan_revision: 1,
        scheduled_session_id: 'session-mon',
        exercise_ids: ['back-squat'],
        combined_load_exercises: [],
        started_at: '2026-09-18T10:00:00Z',
        status: 'active',
      },
      filter: 'id=eq.session-rls',
      patch: { scheduled_session_id: 'session-tue' },
      watched: 'scheduled_session_id',
    },
    {
      table: 'recorded_sets',
      row: {
        user_id: userId,
        set_id: 'set-rls',
        session_id: 'session-rls',
        sequence: 1,
        exercise_id: 'back-squat',
        measurement: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
        recorded_at: '2026-09-18T10:05:00Z',
      },
      filter: 'set_id=eq.set-rls',
      patch: { exercise_id: 'front-squat' },
      watched: 'exercise_id',
    },
    {
      table: 'session_corrections',
      row: {
        user_id: userId,
        session_id: 'session-rls',
        revision: 1,
        set_id: 'set-rls',
        previous: { repetitions: 8 },
        corrected: { repetitions: 9 },
        actor_kind: 'user',
        actor_id: userId,
        corrected_at: '2026-09-18T12:00:00Z',
      },
      filter: 'session_id=eq.session-rls&revision=eq.1',
      patch: { actor_kind: 'agent' },
      watched: 'actor_kind',
    },
    {
      table: 'proposals',
      row: {
        user_id: userId,
        id: 'prop-rls',
        base_revision: 1,
        diff: { op: 'replace_plan', sessions: [] },
        rationale: 'because',
        status: 'pending',
        created_at: '2026-09-18T00:00:00Z',
        decided_at: null,
        actor_client_id: 'client-rls',
        actor_agent_id: 'agent-rls',
        input_hash: 'hash-rls',
        expires_at: FUTURE,
      },
      filter: 'id=eq.prop-rls',
      patch: { rationale: 'tampered' },
      watched: 'rationale',
    },
    {
      table: 'idempotency_records',
      row: {
        user_id: userId,
        key: OWNER_KEY,
        request_fingerprint: 'fingerprint-rls',
        result: { kind: 'applied' },
        mutation: { kind: 'start_session' },
      },
      filter: `key=eq.${OWNER_KEY}`,
      patch: { request_fingerprint: 'tampered' },
      watched: 'request_fingerprint',
    },
  ];
}

const OWNER_RELATIONS = () => relationsFor(owner.id);

function ownerRelation(table: string): Relation {
  const relation = OWNER_RELATIONS().find((candidate) => candidate.table === table);
  if (!relation) throw new Error(`no relation named ${table}`);
  return relation;
}

/** The owner's seeded value for a watched column, read with the service role. */
async function ownerValue(relation: Relation): Promise<unknown> {
  const response = await fetch(
    `${server.url}/rest/v1/${relation.table}?user_id=eq.${owner.id}&${relation.filter}` +
      `&select=${relation.watched}`,
    { headers: admin },
  );
  const rows = (await response.json()) as Record<string, unknown>[];
  return rows[0]?.[relation.watched];
}

async function rowCount(table: string, userId: string, filter: string): Promise<number> {
  const response = await fetch(
    `${server.url}/rest/v1/${table}?user_id=eq.${userId}&${filter}&select=user_id`,
    { headers: admin },
  );
  return ((await response.json()) as unknown[]).length;
}

/** Calls a database function as that user, returning the status and the parsed body. */
async function callRpc(
  identity: DevelopmentIdentity,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${server.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: asUser(identity),
    body: JSON.stringify(args),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
}

/** Seeds every relation for a user, in dependency order, with the service role. */
async function seed(userId: string): Promise<void> {
  const relations = relationsFor(userId);
  for (const relation of [...relations].reverse()) {
    await fetch(`${server.url}/rest/v1/${relation.table}?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: admin,
    });
  }
  for (const relation of relations) {
    await upsert(rest, relation.table, [relation.row]);
  }
}

beforeAll(async () => {
  owner = await signInDevelopmentUser(server, 'rls-owner@workout-logger.invalid');
  intruder = await signInDevelopmentUser(server, 'rls-intruder@workout-logger.invalid');

  // Written with the service role, so no case depends on the very policy it is about to check.
  await seed(owner.id);
  await seed(intruder.id);
}, 180_000);

describe('a signed-in user and another user’s rows', () => {
  it('seeds a real row in every exposed relation, or the denials below prove nothing', async () => {
    for (const relation of OWNER_RELATIONS()) {
      expect(
        await rowCount(relation.table, owner.id, relation.filter),
        `${relation.table} was not seeded`,
      ).toBe(1);
    }
  });

  it('can read its own rows everywhere, so a denial is about the user and not the API', async () => {
    // The control. Without it every denial below could be a role that cannot do anything at
    // all. Writing is deliberately not part of the control: nobody writes these tables
    // directly any more, and that is checked in authenticated-rpc.provider.ts.
    for (const relation of OWNER_RELATIONS()) {
      const read = await fetch(
        `${server.url}/rest/v1/${relation.table}?user_id=eq.${owner.id}&${relation.filter}` +
          `&select=${relation.watched}`,
        { headers: asUser(owner) },
      );
      expect(read.status, relation.table).toBe(200);
      expect(
        (await read.json()) as unknown[],
        `${relation.table} hid the owner's own row`,
      ).toHaveLength(1);
    }
  });

  it('reads nothing of another user, on every exposed relation', async () => {
    for (const relation of OWNER_RELATIONS()) {
      const response = await fetch(
        `${server.url}/rest/v1/${relation.table}?user_id=eq.${owner.id}&select=*`,
        { headers: asUser(intruder) },
      );
      expect(response.status, relation.table).toBe(200);
      expect(
        (await response.json()) as unknown[],
        `${relation.table} leaked rows to another user`,
      ).toEqual([]);
    }
  });

  it('cannot insert a row belonging to another user, on every exposed relation', async () => {
    for (const relation of OWNER_RELATIONS()) {
      const forged = { ...relation.row };
      // A new row, so a refusal cannot be confused with a primary key collision.
      for (const [column, value] of Object.entries(forged)) {
        if (typeof value === 'string' && value.endsWith('-rls')) {
          forged[column] = `${value}-forged`;
        }
      }
      if (relation.table === 'idempotency_records') {
        forged['key'] = '55555555-5555-4555-8555-555555555555';
      }

      const response = await fetch(`${server.url}/rest/v1/${relation.table}`, {
        method: 'POST',
        headers: { ...asUser(intruder), Prefer: 'return=representation' },
        body: JSON.stringify(forged),
      });
      // Refused, not silently ignored.
      expect([401, 403], `${relation.table} accepted a row for another user`).toContain(
        response.status,
      );
      expect(
        await rowCount(relation.table, owner.id, 'user_id=not.is.null'),
        `${relation.table} gained a forged row`,
      ).toBe(1);
    }
  });

  it('cannot update another user’s row, on every exposed relation', async () => {
    for (const relation of OWNER_RELATIONS()) {
      const before = await ownerValue(relation);
      const response = await fetch(
        `${server.url}/rest/v1/${relation.table}?user_id=eq.${owner.id}&${relation.filter}`,
        { method: 'PATCH', headers: asUser(intruder), body: JSON.stringify(relation.patch) },
      );
      expect([401, 403], `${relation.table} answered an update for another user oddly`).toContain(
        response.status,
      );
      expect(await ownerValue(relation), `${relation.table} was changed by another user`).toEqual(
        before,
      );
    }
  });

  it('cannot delete another user’s row, on every exposed relation', async () => {
    // Deepest first, so a deletion that did work could not be excused by a cascade.
    for (const relation of [...OWNER_RELATIONS()].reverse()) {
      const response = await fetch(
        `${server.url}/rest/v1/${relation.table}?user_id=eq.${owner.id}&${relation.filter}`,
        { method: 'DELETE', headers: asUser(intruder) },
      );
      expect([401, 403], `${relation.table} answered a delete for another user oddly`).toContain(
        response.status,
      );
      expect(
        await rowCount(relation.table, owner.id, relation.filter),
        `${relation.table} lost a row to another user`,
      ).toBe(1);
    }
  });

  it('cannot attach a row of its own to another user’s parent', async () => {
    // The composite foreign key is what makes this impossible rather than merely denied: a set
    // belongs to (user, session), so there is no way to point one at another user's session.
    const response = await fetch(`${server.url}/rest/v1/recorded_sets`, {
      method: 'POST',
      headers: { ...asUser(intruder), Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: intruder.id,
        set_id: 'set-crosslink',
        session_id: 'session-rls',
        sequence: 9,
        exercise_id: 'back-squat',
        measurement: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
        recorded_at: '2026-09-18T10:06:00Z',
      }),
    });
    // Refused outright now: a set reaches a session only through apply_workout_mutation.
    expect([401, 403]).toContain(response.status);
    expect(
      await rowCount('recorded_sets', owner.id, 'set_id=eq.set-crosslink'),
      'a set reached another user’s session',
    ).toBe(0);
    await fetch(`${server.url}/rest/v1/recorded_sets?set_id=eq.set-crosslink`, {
      method: 'DELETE',
      headers: admin,
    });
  });

  it('cannot decide another user’s proposal through the database function', async () => {
    for (const decision of ['accept', 'reject']) {
      const { body } = await callRpc(intruder, 'decide_proposal', {
        p_proposal_id: 'prop-rls',
        p_decision: decision,
      });
      // The function looks the proposal up under the caller's own identity. The intruder has a
      // proposal of that id, so this decides theirs; the owner's must be untouched.
      expect(await ownerValue(ownerRelation('proposals'))).toBe('because');
      expect(body).toBeDefined();
    }

    const status = await fetch(
      `${server.url}/rest/v1/proposals?user_id=eq.${owner.id}&id=eq.prop-rls&select=status`,
      { headers: admin },
    );
    expect(
      ((await status.json()) as { status: string }[])[0]?.status,
      'another user decided the owner’s proposal',
    ).toBe('pending');

    const plan = await fetch(
      `${server.url}/rest/v1/plans?user_id=eq.${owner.id}&id=eq.plan-rls&select=revision`,
      { headers: admin },
    );
    expect(((await plan.json()) as { revision: number }[])[0]?.revision).toBe(1);
  });

  it('cannot mark another user’s proposal stale through the database function', async () => {
    await callRpc(intruder, 'mark_proposal_stale_if_pending', { p_proposal_id: 'prop-rls' });

    const status = await fetch(
      `${server.url}/rest/v1/proposals?user_id=eq.${owner.id}&id=eq.prop-rls&select=status`,
      { headers: admin },
    );
    expect(((await status.json()) as { status: string }[])[0]?.status).toBe('pending');
  });

  it('cannot mutate another user’s session through the database function', async () => {
    const { status, body } = await callRpc(intruder, 'apply_workout_mutation', {
      p_key: '66666666-6666-4666-8666-666666666666',
      p_mutation: {
        kind: 'record_set',
        sessionId: 'session-rls',
        set: {
          setId: 'set-intruder',
          exerciseId: 'back-squat',
          sequence: 7,
          measurement: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
          recordedAt: '2026-09-18T10:07:00Z',
        },
      },
    });
    // The intruder's own session of that id is active, so the call is about their row, never
    // the owner's. What matters is where the set landed.
    expect(status).toBeLessThan(500);
    expect(body).toBeDefined();
    expect(
      await rowCount('recorded_sets', owner.id, 'set_id=eq.set-intruder'),
      'another user recorded a set against the owner’s session',
    ).toBe(0);
  });

  it('cannot read another user’s result by reusing their idempotency key', async () => {
    // The key is unique per user, so the same key in another user's hands is a new key and
    // never a replay of the owner's result.
    const { body } = await callRpc(intruder, 'apply_workout_mutation', {
      p_key: OWNER_KEY,
      p_mutation: {
        kind: 'complete_session',
        sessionId: 'session-rls',
        completedAt: '2026-09-18T11:00:00Z',
      },
    });
    expect(
      (body as { kind?: string } | undefined)?.kind,
      'the owner’s result was replayed',
    ).not.toBe('replayed');

    const owned = await fetch(
      `${server.url}/rest/v1/idempotency_records?user_id=eq.${owner.id}` +
        `&key=eq.${OWNER_KEY}&select=request_fingerprint`,
      { headers: admin },
    );
    expect(
      ((await owned.json()) as { request_fingerprint: string }[])[0]?.request_fingerprint,
      'the owner’s idempotency record was overwritten',
    ).toBe('fingerprint-rls');
  });
});
