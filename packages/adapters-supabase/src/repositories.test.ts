import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverConfig } from './config.js';
import { SupabaseProposalStore } from './repositories.js';
import { PostgrestError } from './rest.js';

/**
 * What can be checked about the adapter without a database.
 *
 * The behaviour is checked against a real one by the contract suite in
 * proposal-store.provider.ts, which `pnpm verify` deliberately does not run. What is worth
 * pinning here is the shape of the requests it makes, because those are the things that fail
 * silently: a filter that omits the user, a credential in a URL, an error that loses the
 * server's message.
 *
 * `fetch` is stubbed, so these stay hermetic and secret-free like the rest of the gate.
 */

const config = serverConfig({
  url: 'https://example.supabase.co',
  anonKey: 'anon-key-for-tests',
  serviceRoleKey: 'service-role-key-for-tests',
});
if (!config.ok) throw new Error('the test configuration should be valid');
const server = config.value;

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function stubFetch(response: { status: number; body: string }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    return Promise.resolve(
      new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Supabase proposal store', () => {
  it('filters every read by the user, not only by the row id', async () => {
    // Row-level security filters too, but the server acts with a role that bypasses it. The
    // explicit filter is what stops a bug from reaching another user's rows.
    const calls = stubFetch({ status: 200, body: '[]' });
    await new SupabaseProposalStore(server).findById('user-1', 'prop-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('user_id=eq.user-1');
    expect(calls[0]?.url).toContain('id=eq.prop-1');
  });

  it('never puts a credential in the URL', async () => {
    const calls = stubFetch({ status: 200, body: '[]' });
    await new SupabaseProposalStore(server).findById('user-1', 'prop-1');

    expect(calls[0]?.url).not.toContain('service-role-key-for-tests');
    expect(calls[0]?.url).not.toContain('anon-key-for-tests');
    // It travels in headers, where a log or a referrer will not carry it.
    expect(calls[0]?.headers['apikey']).toBe('service-role-key-for-tests');
  });

  it('commits a decision through the database function, with the expected state', async () => {
    // The compare-and-set cannot be a read then a write from here, so the adapter must call
    // the function that does both in one transaction.
    const calls = stubFetch({ status: 200, body: '{"kind":"committed","revision":6}' });
    const store = new SupabaseProposalStore(server);
    const outcome = await store.commitDecision({
      userId: 'user-1',
      proposal: {
        id: 'prop-1',
        actor: { clientId: 'c', actorId: 'a' },
        baseRevision: 5 as never,
        diff: { op: 'replace_plan', sessions: [] },
        rationale: 'because',
        inputHash: 'hash',
        createdAt: new Date('2026-09-18T00:00:00Z'),
        expiresAt: new Date('2026-09-19T00:00:00Z'),
        status: 'accepted',
      },
      expectedRevision: 5 as never,
      expectedStatus: 'pending',
      advanceRevision: true,
    });

    expect(calls[0]?.url).toContain('/rpc/commit_proposal_decision');
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(sent['p_expected_revision']).toBe(5);
    expect(sent['p_expected_status']).toBe('pending');
    expect(sent['p_advance_revision']).toBe(true);
    expect(outcome).toEqual({ kind: 'committed', revision: 6 });
  });

  it('reports a moved revision as the port describes it', async () => {
    stubFetch({ status: 200, body: '{"kind":"revision_changed","currentRevision":9}' });
    const outcome = await new SupabaseProposalStore(server).commitDecision({
      userId: 'user-1',
      proposal: {
        id: 'prop-1',
        actor: { clientId: 'c', actorId: 'a' },
        baseRevision: 5 as never,
        diff: { op: 'replace_plan', sessions: [] },
        rationale: 'because',
        inputHash: 'hash',
        createdAt: new Date('2026-09-18T00:00:00Z'),
        expiresAt: new Date('2026-09-19T00:00:00Z'),
        status: 'accepted',
      },
      expectedRevision: 5 as never,
      expectedStatus: 'pending',
      advanceRevision: true,
    });
    expect(outcome).toEqual({ kind: 'revision_changed', currentRevision: 9 });
  });

  it('marks stale through the status-only function, never touching the revision', async () => {
    const calls = stubFetch({ status: 200, body: '"marked"' });
    const outcome = await new SupabaseProposalStore(server).markStaleIfPending('user-1', 'prop-1');

    expect(calls[0]?.url).toContain('/rpc/mark_proposal_stale_if_pending');
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent)).not.toContain('p_expected_revision');
    expect(outcome).toBe('marked');
  });

  it('keeps the server’s message when a request fails', async () => {
    // "Request failed" turns a schema mistake into an afternoon.
    stubFetch({
      status: 400,
      body: '{"message":"column proposals.nope does not exist","details":"line 1"}',
    });
    await expect(new SupabaseProposalStore(server).findById('user-1', 'prop-1')).rejects.toThrow(
      /column proposals.nope does not exist \(line 1\)/,
    );
    await expect(
      new SupabaseProposalStore(server).findById('user-1', 'prop-1'),
    ).rejects.toBeInstanceOf(PostgrestError);
  });

  it('still carries its configuration, so wiring can be checked without a database', () => {
    expect(new SupabaseProposalStore(server).projectUrl).toBe('https://example.supabase.co');
  });
});
