import { describe, expect, it } from 'vitest';
import { browserConfig, serverConfig } from './config.js';

const URL_OK = 'https://abcdefgh.supabase.co';

describe('browser config', () => {
  it('accepts an https url and an anon key', () => {
    const result = browserConfig({ url: URL_OK, anonKey: 'anon' });
    expect(result.ok).toBe(true);
  });

  it('refuses a service-role key outright, rather than ignoring it', () => {
    const result = browserConfig({ url: URL_OK, anonKey: 'anon', serviceRoleKey: 'service' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'service_role_key_in_browser_config' });
  });

  it('refuses a plain-http url', () => {
    const result = browserConfig({ url: 'http://abcdefgh.supabase.co', anonKey: 'anon' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'not_https', variable: 'NEXT_PUBLIC_SUPABASE_URL' });
  });

  it('names the missing variable so the error is actionable', () => {
    const result = browserConfig({ url: undefined, anonKey: 'anon' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'missing', variable: 'NEXT_PUBLIC_SUPABASE_URL' });
  });

  it('rejects a non-url string', () => {
    const result = browserConfig({ url: 'not a url', anonKey: 'anon' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_a_url');
  });
});

describe('server config', () => {
  it('requires the service-role key', () => {
    const result = serverConfig({ url: URL_OK, anonKey: 'anon' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'missing', variable: 'SUPABASE_SERVICE_ROLE_KEY' });
  });

  it('accepts a complete server configuration', () => {
    const result = serverConfig({ url: URL_OK, anonKey: 'anon', serviceRoleKey: 'service' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.serviceRoleKey).toBe('service');
  });
});
