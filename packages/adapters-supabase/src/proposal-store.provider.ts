import type { Proposal, Revision } from '@workout/domain';
import { type ContractHarness, PROPOSAL_STORE_CASES } from '@workout/test-support';
import { beforeAll, describe, it } from 'vitest';
import { serverConfig } from './config.js';
import { SupabaseProposalStore } from './repositories.js';
import { upsert } from './rest.js';
import { at } from './test-fixtures.js';
import { signInDevelopmentUser } from './test-identity.js';

/**
 * The proposal store contract, against the real development database (task 2.5, ADR-0005).
 *
 * `.provider.ts`, not `.test.ts`, so `pnpm verify` never runs it: the aggregate gate is
 * hermetic and secret-free, and this needs a network and a credential. Run it deliberately:
 *
 *   pnpm test:provider
 *
 * Every assertion is the contract suite the in-memory reference runs. What this file supplies
 * is the three things a database needs and an object in memory does not: user ids that are
 * real uuids in `auth.users`, an active plan row for the revision to live on, and a signed-in
 * token, because the store acts as a user and not as the service role. Running it with the
 * service role would bypass row-level security and every grant, so the isolation cases would
 * pass without proving anything.
 *
 * It fails rather than skips without an environment. "No credential, so no finding" is the
 * vacuous pass these checks exist to prevent.
 */

const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
const publishableKey = process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
const secretKey = process.env['SUPABASE_SECRET_KEY'];

if (!url || !publishableKey || !secretKey) {
  throw new Error(
    'the provider suite needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and ' +
      'SUPABASE_SECRET_KEY. Run `pnpm test:provider`, which loads .env.local.',
  );
}

const config = serverConfig({ url, publishableKey, secretKey });
if (!config.ok) {
  throw new Error(`the Supabase configuration is invalid: ${JSON.stringify(config.error)}`);
}
const server = config.value;
const rest = { url: server.url, key: server.secretKey };

/** Two throwaway development identities, created once and reused. */
const EMAILS = {
  user: 'contract-user@workout-logger.invalid',
  otherUser: 'contract-other@workout-logger.invalid',
} as const;

const identities = { user: '', otherUser: '' };
let store: SupabaseProposalStore;

/** Creates the development user if it is not there, and returns its id either way. */
async function ensureUser(email: string): Promise<string> {
  const listed = await fetch(`${server.url}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: server.secretKey },
  });
  const { users } = (await listed.json()) as { users?: { id: string; email: string }[] };
  const existing = users?.find((user) => user.email === email);
  if (existing) return existing.id;

  const created = await fetch(`${server.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: server.secretKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const body = (await created.json()) as { id?: string; msg?: string };
  if (!body.id) throw new Error(`could not create the development user: ${body.msg ?? '?'}`);
  return body.id;
}

beforeAll(async () => {
  const signedIn = await signInDevelopmentUser(server, EMAILS.user);
  identities.user = signedIn.id;
  identities.otherUser = await ensureUser(EMAILS.otherUser);
  store = new SupabaseProposalStore(server, signedIn);
}, 60_000);

/**
 * A fresh state per case: the proposals and the plan are replaced, so one case's decision
 * cannot be another case's starting point. Seeding goes around the port under test, which is
 * what the contract's `seed` is for.
 */
async function harness(): Promise<ContractHarness> {
  const userId = identities.user;
  for (const table of ['proposals', 'workout_sessions', 'plans']) {
    await fetch(`${server.url}/rest/v1/${table}?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: { apikey: server.secretKey },
    });
  }

  return {
    store,
    identities: { user: identities.user, otherUser: identities.otherUser },
    seed: async (seedUserId: string, proposal: Proposal, revision: Revision) => {
      await upsert(rest, 'plans', [
        {
          user_id: seedUserId,
          id: 'plan-contract',
          revision,
          status: 'active',
          activated_at: at(-24 * 60),
          sessions: [],
        },
      ]);
      await upsert(rest, 'proposals', [
        {
          user_id: seedUserId,
          id: proposal.id,
          base_revision: proposal.baseRevision,
          diff: proposal.diff,
          rationale: proposal.rationale,
          status: proposal.status,
          created_at: proposal.createdAt.toISOString(),
          decided_at: null,
          actor_client_id: proposal.actor.clientId,
          actor_agent_id: proposal.actor.actorId,
          input_hash: proposal.inputHash,
          // The contract does not model expiry, so its proposals carry a written-down date that
          // is long past by now. The database does model it - the domain refuses to decide an
          // expired proposal at all - so a case about revisions gets an expiry relative to this
          // run instead. Expiry itself is checked in authenticated-rpc.provider.ts.
          expires_at: at(24 * 60),
        },
      ]);
    },
  };
}

describe('ProposalStore contract: supabase development project', () => {
  for (const testCase of PROPOSAL_STORE_CASES) {
    it(testCase.name, async () => {
      await testCase.run(await harness());
    });
  }
});
