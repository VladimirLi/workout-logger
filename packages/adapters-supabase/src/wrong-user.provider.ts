import { beforeAll, describe, expect, it } from 'vitest';
import { serverConfig } from './config.js';
import { upsert } from './rest.js';

/**
 * Wrong-user denial, with real signed-in identities (identity spec, task 2.3; R-013).
 *
 * The anonymous half is `scripts/check-rls.mjs`. This is the other half, and it needs what
 * that one does not: two users who have actually signed in, so the requests carry their own
 * tokens and row-level security has a `auth.uid()` to compare against. Anything less tests the
 * service role, which bypasses the policies entirely and would prove nothing.
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

const TABLES = [
  'plans',
  'workout_sessions',
  'recorded_sets',
  'session_corrections',
  'proposals',
  'idempotency_records',
] as const;

interface Identity {
  readonly id: string;
  readonly accessToken: string;
}

/**
 * Signs a development user in the way the product will: the admin API mints a one-time link,
 * and verifying its token returns a session, which is the same exchange the email code flow
 * makes. Nothing here holds a stored credential of any kind - see the policy scan in
 * scripts/credential-policy.test.ts, which this comment must not trip.
 */
async function signIn(email: string): Promise<Identity> {
  const created = await fetch(`${server.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const createdBody = (await created.json()) as { id?: string };

  const link = await fetch(`${server.url}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  const linkBody = (await link.json()) as {
    hashed_token?: string;
    user?: { id: string };
    msg?: string;
  };
  if (!linkBody.hashed_token) {
    throw new Error(`could not mint a development sign-in: ${linkBody.msg ?? 'no token'}`);
  }

  const verified = await fetch(`${server.url}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: server.anonKey, 'Content-Type': 'application/json' },
    // token_hash, not token: the admin API returns the hashed form, and the endpoint refuses
    // a bare token unless the email is sent with it.
    body: JSON.stringify({ type: 'magiclink', token_hash: linkBody.hashed_token }),
  });
  const session = (await verified.json()) as {
    access_token?: string;
    user?: { id: string };
    msg?: string;
  };
  if (!session.access_token) {
    throw new Error(`could not verify the development sign-in: ${session.msg ?? 'no session'}`);
  }

  // The session's own user, which is the identity the token actually carries. Taking it from
  // anywhere else risks asserting about one user with another one's token.
  const id = session.user?.id ?? linkBody.user?.id ?? createdBody.id;
  if (!id) throw new Error('the development sign-in returned no user id');
  return { id, accessToken: session.access_token };
}

/** A request as that user: their token, and the anonymous key as the API key, like a browser. */
function asUser(identity: Identity): Record<string, string> {
  return {
    apikey: server.anonKey,
    Authorization: `Bearer ${identity.accessToken}`,
    'Content-Type': 'application/json',
  };
}

let owner: Identity;
let intruder: Identity;

beforeAll(async () => {
  owner = await signIn('rls-owner@workout-logger.invalid');
  intruder = await signIn('rls-intruder@workout-logger.invalid');

  // The owner's data, written with the service role so the test does not depend on the very
  // policy it is about to check.
  for (const table of ['recorded_sets', 'workout_sessions', 'plans']) {
    await fetch(`${server.url}/rest/v1/${table}?user_id=eq.${owner.id}`, {
      method: 'DELETE',
      headers: admin,
    });
  }
  await upsert(rest, 'plans', [
    {
      user_id: owner.id,
      id: 'plan-rls',
      revision: 1,
      status: 'active',
      activated_at: '2026-09-18T00:00:00Z',
      sessions: [],
    },
  ]);
}, 120_000);

describe('a signed-in user and another user’s rows', () => {
  it('can read its own row', async () => {
    // Without this the denials below could pass because nothing works at all.
    const response = await fetch(`${server.url}/rest/v1/plans?user_id=eq.${owner.id}&select=id`, {
      headers: asUser(owner),
    });
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown[]).toHaveLength(1);
  });

  it('reads nothing of another user, on every exposed table', async () => {
    for (const table of TABLES) {
      const response = await fetch(
        `${server.url}/rest/v1/${table}?user_id=eq.${owner.id}&select=*`,
        { headers: asUser(intruder) },
      );
      expect(response.status, table).toBe(200);
      expect((await response.json()) as unknown[], `${table} leaked rows to another user`).toEqual(
        [],
      );
    }
  });

  it('cannot write a row belonging to another user', async () => {
    const response = await fetch(`${server.url}/rest/v1/plans`, {
      method: 'POST',
      headers: { ...asUser(intruder), Prefer: 'return=representation' },
      body: JSON.stringify({
        user_id: owner.id,
        id: 'plan-intruder',
        revision: 1,
        status: 'active',
        activated_at: '2026-09-18T00:00:00Z',
        sessions: [],
      }),
    });
    // The WITH CHECK half of the policy: 403, not a silently ignored write.
    expect(response.status).toBe(403);

    const remaining = await fetch(`${server.url}/rest/v1/plans?user_id=eq.${owner.id}&select=id`, {
      headers: admin,
    });
    expect(((await remaining.json()) as { id: string }[]).map((plan) => plan.id)).toEqual([
      'plan-rls',
    ]);
  });

  it('cannot update or delete another user’s row', async () => {
    for (const method of ['PATCH', 'DELETE'] as const) {
      const response = await fetch(
        `${server.url}/rest/v1/plans?user_id=eq.${owner.id}&id=eq.plan-rls`,
        {
          method,
          headers: asUser(intruder),
          ...(method === 'PATCH' ? { body: JSON.stringify({ revision: 99 }) } : {}),
        },
      );
      // A filtered write that matches no visible row is a no-op, not an error. What matters is
      // that the row is untouched, so that is what is checked.
      expect([200, 204, 403, 404]).toContain(response.status);
    }

    const after = await fetch(
      `${server.url}/rest/v1/plans?user_id=eq.${owner.id}&select=revision`,
      { headers: admin },
    );
    expect(((await after.json()) as { revision: number }[])[0]?.revision).toBe(1);
  });
});
