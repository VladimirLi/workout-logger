import type { Result } from '@workout/domain';
import { err, ok } from '@workout/domain';

export interface SupabaseConfigInput {
  readonly url: string | undefined;
  readonly publishableKey: string | undefined;
  readonly secretKey?: string | undefined;
}

export interface BrowserSupabaseConfig {
  readonly url: string;
  readonly publishableKey: string;
}

export interface ServerSupabaseConfig extends BrowserSupabaseConfig {
  readonly secretKey: string;
}

export type ConfigError =
  | { readonly kind: 'missing'; readonly variable: string }
  | { readonly kind: 'not_https'; readonly variable: string }
  | { readonly kind: 'not_a_url'; readonly variable: string }
  | { readonly kind: 'invalid_key_format'; readonly variable: string }
  | { readonly kind: 'secret_key_in_browser_config' };

const PUBLISHABLE_PREFIX = 'sb_publishable_';
const SECRET_PREFIX = 'sb_secret_';

function requireHttpsUrl(value: string | undefined, variable: string): Result<string, ConfigError> {
  if (!value) {
    return err({ kind: 'missing', variable });
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return err({ kind: 'not_a_url', variable });
  }
  if (parsed.protocol !== 'https:') {
    return err({ kind: 'not_https', variable });
  }
  return ok(value);
}

function requireKeyFormat(
  value: string | undefined,
  variable: string,
  prefix: string,
): Result<string, ConfigError> {
  if (!value) {
    return err({ kind: 'missing', variable });
  }
  if (!value.startsWith(prefix)) {
    return err({ kind: 'invalid_key_format', variable });
  }
  return ok(value);
}

export function browserConfig(
  input: SupabaseConfigInput,
): Result<BrowserSupabaseConfig, ConfigError> {
  if (input.secretKey) {
    return err({ kind: 'secret_key_in_browser_config' });
  }
  const url = requireHttpsUrl(input.url, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!url.ok) {
    return url;
  }
  const publishableKey = requireKeyFormat(
    input.publishableKey,
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    PUBLISHABLE_PREFIX,
  );
  if (!publishableKey.ok) {
    return publishableKey;
  }
  return ok({ url: url.value, publishableKey: publishableKey.value });
}

export function serverConfig(
  input: SupabaseConfigInput,
): Result<ServerSupabaseConfig, ConfigError> {
  const url = requireHttpsUrl(input.url, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!url.ok) {
    return url;
  }
  const publishableKey = requireKeyFormat(
    input.publishableKey,
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    PUBLISHABLE_PREFIX,
  );
  if (!publishableKey.ok) {
    return publishableKey;
  }
  const secretKey = requireKeyFormat(input.secretKey, 'SUPABASE_SECRET_KEY', SECRET_PREFIX);
  if (!secretKey.ok) {
    return secretKey;
  }
  return ok({
    url: url.value,
    publishableKey: publishableKey.value,
    secretKey: secretKey.value,
  });
}
