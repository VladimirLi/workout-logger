import { describe, expect, it } from 'vitest';
import { browserConfig, serverConfig } from './config.js';

const URL_OK = 'https://abcdefgh.supabase.co';
const PUBLISHABLE = 'sb_publishable_test_key';
const SECRET = 'sb_secret_test_key';

describe('browser config', () => {
  it('accepts an https url and a publishable key', () => {
    const result = browserConfig({ url: URL_OK, publishableKey: PUBLISHABLE });
    expect(result.ok).toBe(true);
  });

  it('refuses a secret key outright, rather than ignoring it', () => {
    const result = browserConfig({
      url: URL_OK,
      publishableKey: PUBLISHABLE,
      secretKey: SECRET,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'secret_key_in_browser_config' });
  });

  it('refuses a plain-http url', () => {
    const result = browserConfig({
      url: 'http://abcdefgh.supabase.co',
      publishableKey: PUBLISHABLE,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'not_https', variable: 'NEXT_PUBLIC_SUPABASE_URL' });
  });

  it('names the missing variable so the error is actionable', () => {
    const result = browserConfig({ url: undefined, publishableKey: PUBLISHABLE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'missing', variable: 'NEXT_PUBLIC_SUPABASE_URL' });
  });

  it('rejects a non-url string', () => {
    const result = browserConfig({ url: 'not a url', publishableKey: PUBLISHABLE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('not_a_url');
  });

  it('rejects a key that does not use the publishable prefix', () => {
    const result = browserConfig({ url: URL_OK, publishableKey: 'not-a-publishable-key' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'invalid_key_format',
      variable: 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    });
  });
});

describe('server config', () => {
  it('requires the secret key', () => {
    const result = serverConfig({ url: URL_OK, publishableKey: PUBLISHABLE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({ kind: 'missing', variable: 'SUPABASE_SECRET_KEY' });
  });

  it('rejects a key that does not use the secret prefix', () => {
    const result = serverConfig({
      url: URL_OK,
      publishableKey: PUBLISHABLE,
      secretKey: 'not-a-secret-key',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'invalid_key_format',
      variable: 'SUPABASE_SECRET_KEY',
    });
  });

  it('accepts a complete server configuration', () => {
    const result = serverConfig({
      url: URL_OK,
      publishableKey: PUBLISHABLE,
      secretKey: SECRET,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.secretKey).toBe(SECRET);
    expect(result.value.publishableKey).toBe(PUBLISHABLE);
  });
});
