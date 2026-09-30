import type { CommitDecisionRequest } from '@workout/application';
import type { Revision } from '@workout/domain';
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
  publishableKey: 'sb_publishable_test_key',
  secretKey: 'sb_secret_test_key',
});
if (!config.ok) throw new Error('the test configuration should be valid');
const server = config.value;
const USER = { id: 'user-1', accessToken: 'a-user-access-token' } as const;

/**
 * A plan diff the wire contract accepts. `replace_plan` requires at least one session, so an
 * empty one is not a diff a stored row could have come from.
 */
const A_DIFF = {
  op: 'replace_plan',
  sessions: [
    {
      id: 'session-mon',
      scheduledFor: '2026-09-21',
      exercises: [
        {
          exerciseId: 'split-squat',
          prescription: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
        },
      ],
    },
  ],
} as const;

/** A proposals row as PostgREST returns one. */
function aRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'prop-1',
    base_revision: 5,
    diff: A_DIFF,
    rationale: 'because',
    status: 'pending',
    created_at: '2026-09-18T00:00:00Z',
    decided_at: null,
    actor_client_id: 'client-1',
    actor_agent_id: 'agent-1',
    input_hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    expires_at: '2026-09-19T00:00:00Z',
    ...overrides,
  };
}

/** A decision request as the use case makes one: an acceptance against revision 5. */
function aCommit(
  overrides: { status?: 'accepted' | 'rejected'; advanceRevision?: boolean } = {},
): CommitDecisionRequest {
  const { status = 'accepted', advanceRevision = status === 'accepted' } = overrides;
  return {
    userId: 'user-1',
    proposal: {
      id: 'prop-1',
      actor: { clientId: 'c', actorId: 'a' },
      baseRevision: 5 as Revision,
      diff: A_DIFF,
      rationale: 'because',
      inputHash: 'hash',
      createdAt: new Date('2026-09-18T00:00:00Z'),
      expiresAt: new Date('2026-09-19T00:00:00Z'),
      status,
    },
    expectedRevision: 5 as Revision,
    expectedStatus: 'pending',
    advanceRevision,
  };
}

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
    await new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain('user_id=eq.user-1');
    expect(calls[0]?.url).toContain('id=eq.prop-1');
  });

  it('never puts a credential in the URL', async () => {
    const calls = stubFetch({ status: 200, body: '[]' });
    await new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1');

    expect(calls[0]?.url).not.toContain('sb_secret_test_key');
    expect(calls[0]?.url).not.toContain('sb_publishable_test_key');
    expect(calls[0]?.url).not.toContain('a-user-access-token');
    expect(calls[0]?.headers['apikey']).toBe('sb_publishable_test_key');
    expect(calls[0]?.headers['Authorization']).toBe('Bearer a-user-access-token');
  });

  it('carries the compare-and-set to the server when it accepts', async () => {
    // The port mandates a compare-and-set over the revision AND the status
    // (packages/application/src/ports.ts). The adapter used to drop all three inputs and send
    // only the intent, which left the contract enforced nowhere: the server derived its own
    // answer, so a caller that had decided against a different revision was never told.
    const calls = stubFetch({ status: 200, body: '{"kind":"committed","revision":6}' });
    const outcome = await new SupabaseProposalStore(server, USER).commitDecision(aCommit());

    expect(calls[0]?.url).toContain('/rpc/accept_proposal');
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    // The expectations, and nothing else. The decision time, the target status and whether the
    // plan advances remain the server's, derived from rows it locks.
    expect(sent).toEqual({
      p_proposal_id: 'prop-1',
      p_expected_status: 'pending',
      p_expected_revision: 5,
    });
    expect(outcome).toEqual({ kind: 'committed', revision: 6 });
  });

  it('carries only the status compare-and-set when it rejects', async () => {
    // A rejection is about the proposal's content, so it must not read or advance the revision -
    // and therefore must not send one either.
    const calls = stubFetch({ status: 200, body: '{"kind":"committed"}' });
    const outcome = await new SupabaseProposalStore(server, USER).commitDecision(
      aCommit({ status: 'rejected', advanceRevision: false }),
    );

    expect(calls[0]?.url).toContain('/rpc/reject_proposal');
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      p_proposal_id: 'prop-1',
      p_expected_status: 'pending',
    });
    expect(outcome).toEqual({ kind: 'committed' });
  });

  it('refuses a request whose advanceRevision contradicts its own decision', async () => {
    // An acceptance changes the plan and a rejection does not, so these cannot disagree. A
    // caller that says otherwise has a bug, and carrying on would commit one of the two
    // meanings silently.
    const calls = stubFetch({ status: 200, body: '{"kind":"committed","revision":6}' });
    const store = new SupabaseProposalStore(server, USER);

    await expect(store.commitDecision(aCommit({ advanceRevision: false }))).rejects.toThrow(
      /advance/i,
    );
    await expect(
      store.commitDecision(aCommit({ status: 'rejected', advanceRevision: true })),
    ).rejects.toThrow(/advance/i);
    expect(calls, 'a contradictory request reached the server').toHaveLength(0);
  });

  it('refuses a status the domain does not define, whatever the server said', async () => {
    // The body is untrusted input like any other response. A status outside the vocabulary
    // would otherwise flow into the domain as a valid one.
    stubFetch({ status: 200, body: '{"kind":"status_changed","currentStatus":"half_accepted"}' });
    await expect(new SupabaseProposalStore(server, USER).commitDecision(aCommit())).rejects.toThrow(
      /understand/,
    );
  });

  it('refuses a revision that is not a positive whole number', async () => {
    for (const body of [
      '{"kind":"committed","revision":0}',
      '{"kind":"committed","revision":-3}',
      '{"kind":"committed","revision":6.5}',
      '{"kind":"revision_changed","currentRevision":0}',
      '{"kind":"revision_changed","currentRevision":"9"}',
    ]) {
      stubFetch({ status: 200, body });
      await expect(
        new SupabaseProposalStore(server, USER).commitDecision(aCommit()),
        body,
      ).rejects.toThrow(/understand/);
      vi.unstubAllGlobals();
    }
  });

  it('reports a moved revision as the port describes it', async () => {
    stubFetch({ status: 200, body: '{"kind":"revision_changed","currentRevision":9}' });
    const outcome = await new SupabaseProposalStore(server, USER).commitDecision(aCommit());
    expect(outcome).toEqual({ kind: 'revision_changed', currentRevision: 9 });
  });

  it('marks stale through the status-only function, never touching the revision', async () => {
    const calls = stubFetch({ status: 200, body: '"marked"' });
    const outcome = await new SupabaseProposalStore(server, USER).markStaleIfPending(
      'user-1',
      'prop-1',
    );

    expect(calls[0]?.url).toContain('/rpc/mark_proposal_stale_if_pending');
    const sent = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toEqual({ p_proposal_id: 'prop-1' });
    expect(outcome).toBe('marked');
  });

  it('makes no request at all when asked to act for a different user', async () => {
    // The functions take their identity from the token, so a call naming someone else cannot
    // be carried out. Without this it would be carried out against this user's own rows.
    const calls = stubFetch({ status: 200, body: '"marked"' });
    const store = new SupabaseProposalStore(server, USER);

    expect(await store.markStaleIfPending('user-2', 'prop-1')).toBe('not_found');
    expect(await store.rejectIfPending('user-2', 'prop-1')).toEqual({ kind: 'not_found' });
    expect(calls).toHaveLength(0);
  });

  it('keeps the server’s message when a request fails', async () => {
    // "Request failed" turns a schema mistake into an afternoon.
    stubFetch({
      status: 400,
      body: '{"message":"column proposals.nope does not exist","details":"line 1"}',
    });
    await expect(
      new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'),
    ).rejects.toThrow(/column proposals.nope does not exist \(line 1\)/);
    await expect(
      new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'),
    ).rejects.toBeInstanceOf(PostgrestError);
  });

  it('round-trips a row the contract accepts', async () => {
    stubFetch({ status: 200, body: JSON.stringify([aRow()]) });
    const proposal = await new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1');

    expect(proposal?.id).toBe('prop-1');
    expect(proposal?.baseRevision).toBe(5);
    expect(proposal?.status).toBe('pending');
    expect(proposal?.diff).toEqual(A_DIFF);
    expect(proposal?.createdAt.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('reads a stored diff that carries names and rest, and one written before either existed', async () => {
    const named = {
      op: 'replace_plan',
      name: 'Upper / lower',
      sessions: [
        {
          id: 'session-mon',
          name: 'Lower A',
          scheduledFor: '2026-09-21',
          exercises: [
            {
              exerciseId: 'split-squat',
              name: 'Split squat',
              restSeconds: 120,
              prescription: { schemaVersion: 1, profile: 'strength', repetitions: 8 },
            },
          ],
        },
      ],
    };
    stubFetch({ status: 200, body: JSON.stringify([aRow({ diff: named })]) });
    expect(
      (await new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'))?.diff,
    ).toEqual(named);
    // A_DIFF has no names at all: a proposal stored before names existed must stay readable.
    stubFetch({ status: 200, body: JSON.stringify([aRow()]) });
    expect(
      (await new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'))?.diff,
    ).toEqual(A_DIFF);
  });

  it('refuses a stored diff whose name is blank or too long', async () => {
    for (const name of ['   ', 'x'.repeat(61)]) {
      stubFetch({
        status: 200,
        body: JSON.stringify([aRow({ diff: { ...A_DIFF, name } })]),
      });
      await expect(
        new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'),
      ).rejects.toThrow(/diff/);
    }
  });

  it.each([
    ['a status the domain does not define', { status: 'half_accepted' }],
    ['a revision that is not a positive whole number', { base_revision: 0 }],
    ['a revision that arrived as a string', { base_revision: '5' }],
    ['a revision that is fractional', { base_revision: 5.5 }],
    ['a diff whose operation is unknown', { diff: { op: 'rewrite_history' } }],
    ['a diff that is not an object', { diff: 'replace_plan' }],
    ['no id', { id: undefined }],
    ['an id that is not a string', { id: 7 }],
    ['a rationale that is not a string', { rationale: null }],
    ['a creation time that is not a time', { created_at: 'the other day' }],
    ['an expiry that is not a time', { expires_at: 'never' }],
    ['a decision time that is not a time', { decided_at: 'yesterday' }],
    // `new Date` accepts all of these and interprets the ones without an offset in whatever
    // zone the machine is in, so a proposal's lifetime moves by hours between two readers. The
    // contract requires an ISO-8601 instant with an explicit offset
    // (packages/contracts/src/primitives.ts).
    ['a creation date with no time', { created_at: '2026-09-18' }],
    ['a space-separated creation time', { created_at: '2026-09-18 00:00:00+00' }],
    ['a creation time with no offset', { created_at: '2026-09-18T00:00:00' }],
    ['a written-out creation date', { created_at: 'Sep 18 2026' }],
    ['an expiry with no offset', { expires_at: '2026-09-19T00:00:00' }],
    ['an expiry date with no time', { expires_at: '2026-09-19' }],
    ['a decision time with no offset', { decided_at: '2026-09-18T12:00:00' }],
    ['an actor field that is not a string', { actor_client_id: 42 }],
  ])('refuses %s, rather than handing it to the domain', async (_label, overrides) => {
    // A row is untrusted input like any response (ADR-0012). Casting one into the domain's
    // types moves the failure to wherever the value is finally used, with no clue where it
    // came from - and a status outside the vocabulary has no rule anywhere to catch it.
    stubFetch({ status: 200, body: JSON.stringify([aRow(overrides)]) });
    await expect(
      new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'),
    ).rejects.toThrow(/proposals row/);
  });

  it.each([
    ['the offset the product writes', '2026-09-18T00:00:00.000Z'],
    ['the offset a database returns', '2026-09-18T00:00:00.872+00:00'],
    ['microsecond precision, which Postgres uses', '2026-09-18T00:00:00.932021+00:00'],
    ['a zone that is not UTC', '2026-09-18T02:00:00+02:00'],
  ])('accepts %s', async (_label, created_at) => {
    // The control: the formats a real row actually carries must still read.
    stubFetch({ status: 200, body: JSON.stringify([aRow({ created_at })]) });
    const proposal = await new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1');
    expect(proposal?.createdAt.toISOString()).toBe(new Date(created_at).toISOString());
  });

  it('refuses a body that is not a list of rows', async () => {
    stubFetch({ status: 200, body: '{"id":"prop-1"}' });
    await expect(
      new SupabaseProposalStore(server, USER).findById('user-1', 'prop-1'),
    ).rejects.toThrow(/list of rows/);
  });

  it.each([
    ['a string', '[{"revision":"7"}]'],
    ['zero', '[{"revision":0}]'],
    ['fractional', '[{"revision":7.5}]'],
    ['absent', '[{}]'],
  ])('refuses a plan revision that is %s', async (_label, body) => {
    stubFetch({ status: 200, body });
    await expect(new SupabaseProposalStore(server, USER).currentRevision('user-1')).rejects.toThrow(
      /revision/,
    );
  });

  it('still carries its configuration, so wiring can be checked without a database', () => {
    expect(new SupabaseProposalStore(server, USER).projectUrl).toBe('https://example.supabase.co');
  });
});
