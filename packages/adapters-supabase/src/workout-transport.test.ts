import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverConfig } from './config.js';
import { SupabaseWorkoutTransport } from './workout-transport.js';

/**
 * What the transport makes of a response, without a database.
 *
 * The cases that matter are the ones a real server produces rarely and a stub produces on
 * demand: a body this version does not recognise, and a refusal that says how long to wait.
 * Both decide whether a queued change is delivered, retried, or stranded, so neither should
 * depend on a provider suite that `pnpm verify` never runs.
 *
 * `fetch` is stubbed, so these stay hermetic and secret-free like the rest of the gate.
 */

const config = serverConfig({
  url: 'https://example.supabase.co',
  anonKey: 'anon-key-for-tests',
  serviceRoleKey: 'service-role-key-for-tests',
});
if (!config.ok) throw new Error('the test configuration should be valid');
const transport = new SupabaseWorkoutTransport(config.value, 'a-user-access-token');

function stubFetch(response: { status: number; body: string; headers?: Record<string, string> }) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(response.body, {
        status: response.status,
        headers: { 'Content-Type': 'application/json', ...response.headers },
      }),
    ),
  );
}

const send = () =>
  transport.send({
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    mutation: { kind: 'start_session' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the Supabase workout transport', () => {
  it('reports an applied mutation and a replay alike, which is what makes a retry safe', async () => {
    for (const kind of ['applied', 'replayed']) {
      stubFetch({ status: 200, body: `{"kind":"${kind}"}` });
      expect(await send()).toEqual({ kind: 'response', status: 200 });
    }
  });

  it('reports a key reused for a different payload as permanent', async () => {
    stubFetch({ status: 200, body: '{"kind":"key_reused"}' });
    // 409: needs a person, never a retry.
    expect(await send()).toEqual({ kind: 'response', status: 409 });
  });

  it('retries a success it does not understand rather than acknowledging it', async () => {
    // Treating an unknown body as success would leave the device believing a change was
    // delivered that may never have been applied; treating it as permanent would strand the
    // entry as needing attention. Neither is recoverable without a person.
    stubFetch({ status: 200, body: '{"kind":"something_this_version_never_heard_of"}' });
    expect(await send()).toEqual({ kind: 'response', status: 502 });

    stubFetch({ status: 200, body: 'null' });
    expect(await send()).toEqual({ kind: 'response', status: 502 });
  });

  it('keeps the delay the server asked for', async () => {
    // The offline-sync contract: a server-directed delay wins over the client's own backoff,
    // so it has to survive the trip through the transport as the header said it.
    stubFetch({
      status: 429,
      body: '{"message":"too many requests"}',
      headers: { 'Retry-After': '120' },
    });
    expect(await send()).toEqual({ kind: 'response', status: 429, retryAfter: '120' });

    stubFetch({
      status: 503,
      body: '{"message":"unavailable"}',
      headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    });
    expect(await send()).toEqual({
      kind: 'response',
      status: 503,
      retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT',
    });
  });

  it('omits the delay when the server did not name one', async () => {
    stubFetch({ status: 500, body: '{"message":"boom"}' });
    expect(await send()).toEqual({ kind: 'response', status: 500 });
  });

  it('reports no response at all as a network error, which the policy retries', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('failed to fetch')));
    expect(await send()).toEqual({ kind: 'network_error' });
  });
});
