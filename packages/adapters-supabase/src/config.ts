import type { Result } from '@workout/domain';
import { err, ok } from '@workout/domain';

/**
 * Deterministic configuration validation for the Supabase adapter.
 *
 * No project exists yet (docs/external-gates.md, G-2). What CAN be verified
 * without credentials is that the configuration we would use is well formed, and
 * that we never accidentally ship a service-role key to a browser. Both are
 * checked here and tested offline.
 */

export interface SupabaseConfigInput {
  readonly url: string | undefined;
  readonly anonKey: string | undefined;
  readonly serviceRoleKey?: string | undefined;
}

export interface BrowserSupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

export interface ServerSupabaseConfig extends BrowserSupabaseConfig {
  readonly serviceRoleKey: string;
}

export type ConfigError =
  | { readonly kind: 'missing'; readonly variable: string }
  | { readonly kind: 'not_https'; readonly variable: string }
  | { readonly kind: 'not_a_url'; readonly variable: string }
  | { readonly kind: 'service_role_key_in_browser_config' };

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

/**
 * Browser-safe configuration. Deliberately has no field for the service-role key,
 * and refuses input that carries one, so a copy-paste mistake fails loudly
 * instead of shipping a god credential to a phone (SECURITY.md).
 */
export function browserConfig(
  input: SupabaseConfigInput,
): Result<BrowserSupabaseConfig, ConfigError> {
  if (input.serviceRoleKey) {
    return err({ kind: 'service_role_key_in_browser_config' });
  }
  const url = requireHttpsUrl(input.url, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!url.ok) {
    return url;
  }
  if (!input.anonKey) {
    return err({ kind: 'missing', variable: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' });
  }
  return ok({ url: url.value, anonKey: input.anonKey });
}

export function serverConfig(
  input: SupabaseConfigInput,
): Result<ServerSupabaseConfig, ConfigError> {
  const url = requireHttpsUrl(input.url, 'NEXT_PUBLIC_SUPABASE_URL');
  if (!url.ok) {
    return url;
  }
  if (!input.anonKey) {
    return err({ kind: 'missing', variable: 'NEXT_PUBLIC_SUPABASE_ANON_KEY' });
  }
  if (!input.serviceRoleKey) {
    return err({ kind: 'missing', variable: 'SUPABASE_SERVICE_ROLE_KEY' });
  }
  return ok({ url: url.value, anonKey: input.anonKey, serviceRoleKey: input.serviceRoleKey });
}
