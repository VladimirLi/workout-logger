import type { AuthorizationContext } from './authorization.js';

export type TokenHygieneFailure = {
  readonly kind: 'token_present';
  readonly surface: 'text' | 'url' | 'argv';
};

export type TokenHygieneResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: TokenHygieneFailure };

export function claimsForDiagnostics(context: AuthorizationContext): Record<string, string> {
  return {
    clientId: context.clientId,
    scopes: context.scopes.join(' '),
    issuedAt: context.issuedAt.toISOString(),
    expiresAt: context.expiresAt.toISOString(),
    audience: context.audience,
  };
}

export function assertTokenAbsentFromText(haystack: string, token: string): TokenHygieneResult {
  if (token.length === 0) return { ok: true };
  if (haystack.includes(token)) {
    return { ok: false, failure: { kind: 'token_present', surface: 'text' } };
  }
  return { ok: true };
}

export function assertTokenAbsentFromUrl(url: string, token: string): TokenHygieneResult {
  if (token.length === 0) return { ok: true };
  if (url.includes(token)) {
    return { ok: false, failure: { kind: 'token_present', surface: 'url' } };
  }
  return { ok: true };
}

export function assertTokenAbsentFromArgv(
  argv: readonly string[],
  token: string,
): TokenHygieneResult {
  if (token.length === 0) return { ok: true };
  if (argv.some((arg) => arg.includes(token))) {
    return { ok: false, failure: { kind: 'token_present', surface: 'argv' } };
  }
  return { ok: true };
}
