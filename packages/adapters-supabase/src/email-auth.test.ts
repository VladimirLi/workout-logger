import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserConfig } from './config.js';
import { createEmailAuth } from './email-auth.js';

const URL_OK = 'https://example.supabase.co';
const PUBLISHABLE = 'sb_publishable_test_key';

function config() {
  const result = browserConfig({ url: URL_OK, publishableKey: PUBLISHABLE });
  if (!result.ok) throw new Error('config');
  return result.value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createEmailAuth', () => {
  it('requests an email code with the publishable key only', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const auth = createEmailAuth(config());
    const result = await auth.requestCode('user@example.com');
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_OK}/auth/v1/otp`);
    const headers = init.headers as Record<string, string>;
    expect(headers.apikey).toBe(PUBLISHABLE);
    expect(headers.Authorization).toBeUndefined();
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'user@example.com',
      create_user: true,
    });
  });

  it('maps rate limits when requesting a code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error_code: 'over_email_send_rate_limit', msg: 'slow' }), {
            status: 429,
          }),
      ),
    );
    const result = await createEmailAuth(config()).requestCode('user@example.com');
    expect(result).toEqual({ ok: false, error: { kind: 'rate_limited' } });
  });

  it('verifies an email code into a session', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'access-token',
            user: { id: 'user-1' },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await createEmailAuth(config()).verifyCode('user@example.com', '12345678');
    expect(result).toEqual({
      ok: true,
      value: { userId: 'user-1', accessToken: 'access-token' },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_OK}/auth/v1/verify`);
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'email',
      email: 'user@example.com',
      token: '12345678',
    });
  });

  it('maps a bad code to invalid_code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ msg: 'bad' }), { status: 400 })),
    );
    const result = await createEmailAuth(config()).verifyCode('user@example.com', '00000000');
    expect(result).toEqual({ ok: false, error: { kind: 'invalid_code' } });
  });
});
