import { isExposed, requiredScope, type Scope, type ToolName } from './tool-surface.js';

/**
 * Per-invocation authorization (R-020, R-021).
 *
 * Every invocation is re-authorized. There is no session cache and no "already
 * checked this connection" path, because that is where scope escapes happen.
 *
 * The OAuth resource server itself is not implemented: it needs a real
 * authorization server and HTTPS origin (docs/external-gates.md, G-1/G-3/G-4).
 * What is implemented and tested here is the decision logic that will sit behind
 * it, so the rule is not invented later under deadline.
 */

export interface AuthorizationContext {
  readonly clientId: string;
  readonly scopes: readonly string[];
  /**
   * When the token was minted. Required, because expiry alone says nothing about
   * lifetime: a token issued with a two-year expiry passes an "is it expired yet?"
   * check for two years.
   */
  readonly issuedAt: Date;
  /** Access-token expiry. Tokens expire within 15 minutes (SECURITY.md). */
  readonly expiresAt: Date;
  /** The resource identifier the token was issued for; audience must match. */
  readonly audience: string;
}

export const MAX_ACCESS_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/**
 * Tolerance for a token whose issuance time is slightly ahead of this server's clock.
 *
 * Zero on purpose. Any tolerance is a window in which a token is accepted before it
 * exists. If distributed clocks ever require one, it must be raised here explicitly and
 * kept to seconds - never introduced implicitly by leaving the check out.
 */
export const ISSUED_AT_CLOCK_SKEW_MS = 0;

export type AuthorizationFailure =
  | { readonly kind: 'unknown_tool'; readonly tool: string }
  /** issuedAt or expiresAt is unparseable, or expiry is not after issuance. */
  | { readonly kind: 'invalid_validity_window'; readonly issuedAt: Date; readonly expiresAt: Date }
  /** The token was minted with a longer lifetime than SECURITY.md permits. */
  | {
      readonly kind: 'lifetime_too_long';
      readonly lifetimeMs: number;
      readonly maximumMs: number;
    }
  /** The token's validity window has not started yet. */
  | { readonly kind: 'token_not_yet_valid'; readonly issuedAt: Date }
  | { readonly kind: 'token_expired'; readonly expiresAt: Date }
  | { readonly kind: 'audience_mismatch'; readonly expected: string; readonly received: string }
  | { readonly kind: 'missing_scope'; readonly required: Scope };

export interface AuthorizationRequest {
  readonly tool: string;
  readonly context: AuthorizationContext;
  readonly resourceIdentifier: string;
  readonly now: Date;
}

export function authorizeInvocation(
  request: AuthorizationRequest,
):
  | { readonly ok: true; readonly tool: ToolName }
  | { readonly ok: false; readonly failure: AuthorizationFailure } {
  const { tool, context, resourceIdentifier, now } = request;

  if (!isExposed(tool)) {
    return { ok: false, failure: { kind: 'unknown_tool', tool } };
  }

  const issuedAt = context.issuedAt.getTime();
  const expiresAt = context.expiresAt.getTime();

  // Validity-window checks come before expiry and before scope. A token whose window
  // is malformed or over-long is not a token we reason about further.
  if (Number.isNaN(issuedAt) || Number.isNaN(expiresAt) || expiresAt <= issuedAt) {
    return {
      ok: false,
      failure: {
        kind: 'invalid_validity_window',
        issuedAt: context.issuedAt,
        expiresAt: context.expiresAt,
      },
    };
  }

  const lifetimeMs = expiresAt - issuedAt;
  if (lifetimeMs > MAX_ACCESS_TOKEN_LIFETIME_MS) {
    return {
      ok: false,
      failure: {
        kind: 'lifetime_too_long',
        lifetimeMs,
        maximumMs: MAX_ACCESS_TOKEN_LIFETIME_MS,
      },
    };
  }

  // Before expiry, audience and scope. A window that starts in the future is by
  // construction not expired, so checking only its end - as this function used to - let a
  // correctly ordered, fifteen-minute token minted for some later date authorize today.
  if (issuedAt > now.getTime() + ISSUED_AT_CLOCK_SKEW_MS) {
    return { ok: false, failure: { kind: 'token_not_yet_valid', issuedAt: context.issuedAt } };
  }

  if (now.getTime() >= expiresAt) {
    return { ok: false, failure: { kind: 'token_expired', expiresAt: context.expiresAt } };
  }
  if (context.audience !== resourceIdentifier) {
    return {
      ok: false,
      failure: {
        kind: 'audience_mismatch',
        expected: resourceIdentifier,
        received: context.audience,
      },
    };
  }
  const required = requiredScope(tool);
  if (!context.scopes.includes(required)) {
    return { ok: false, failure: { kind: 'missing_scope', required } };
  }
  return { ok: true, tool };
}
