import { describe, expect, it } from 'vitest';
import {
  type AuthorizationContext,
  authorizeInvocation,
  ISSUED_AT_CLOCK_SKEW_MS,
  MAX_ACCESS_TOKEN_LIFETIME_MS,
} from './authorization.js';

const RESOURCE = 'https://mcp.gym.vladimirli.com';
const NOW = new Date('2026-09-16T12:00:00.000Z');

function context(overrides: Partial<AuthorizationContext> = {}): AuthorizationContext {
  return {
    clientId: 'client_abc',
    scopes: ['workout:read', 'proposal:create'],
    issuedAt: new Date(NOW.getTime() - 60 * 1000),
    expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
    audience: RESOURCE,
    ...overrides,
  };
}

function authorize(tool: string, ctx = context()) {
  return authorizeInvocation({ tool, context: ctx, resourceIdentifier: RESOURCE, now: NOW });
}

describe('per-invocation authorization', () => {
  it('authorizes a read with the read scope', () => {
    expect(authorize('workout.scheduled_sessions').ok).toBe(true);
  });

  it('rejects an unknown tool before looking at scopes', () => {
    const result = authorize('workout.run_sql', context({ scopes: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'unknown_tool', tool: 'workout.run_sql' });
  });

  it('rejects an expired token', () => {
    const result = authorize('workout.scheduled_sessions', context({ expiresAt: NOW }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('token_expired');
  });

  it('rejects a token issued for a different audience', () => {
    const result = authorize(
      'workout.scheduled_sessions',
      context({ audience: 'https://elsewhere.example' }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: 'audience_mismatch',
      expected: RESOURCE,
      received: 'https://elsewhere.example',
    });
  });

  it('refuses a proposal tool when only the read scope was granted', () => {
    const result = authorize('proposal.replace_plan', context({ scopes: ['workout:read'] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ kind: 'missing_scope', required: 'proposal:create' });
  });

  it('enforces read scope separately from proposal scope', () => {
    const proposalOnly = context({ scopes: ['proposal:create'] });
    expect(authorize('workout.scheduled_sessions', proposalOnly).ok).toBe(false);
    expect(authorize('proposal.replace_plan', proposalOnly).ok).toBe(true);
  });

  it('pins the maximum access-token lifetime at 15 minutes', () => {
    expect(MAX_ACCESS_TOKEN_LIFETIME_MS).toBe(900_000);
  });
});

describe('declared token lifetime is enforced, not merely declared', () => {
  /**
   * SECURITY.md states access tokens expire within 15 minutes. The check used to be
   * expiry alone, which says nothing about lifetime: a token minted with a two-year
   * expiry passes an "is it expired yet?" test for two years. Declared-but-unenforced
   * security behaviour is worse than an absent rule, because it reads as a control.
   */

  const minted = (issuedMinutesAgo: number, lifetimeMinutes: number) =>
    context({
      issuedAt: new Date(NOW.getTime() - issuedMinutesAgo * 60_000),
      expiresAt: new Date(NOW.getTime() - issuedMinutesAgo * 60_000 + lifetimeMinutes * 60_000),
    });

  it('accepts a token whose lifetime is within the bound', () => {
    expect(authorize('workout.scheduled_sessions', minted(1, 15)).ok).toBe(true);
  });

  it('accepts a token minted for exactly the maximum lifetime', () => {
    expect(authorize('workout.scheduled_sessions', minted(0, 15)).ok).toBe(true);
  });

  it('refuses a token minted with a longer lifetime, even before it expires', () => {
    const result = authorize('workout.scheduled_sessions', minted(1, 16));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('lifetime_too_long');
  });

  it('refuses a long-lived token however far from expiry it is', () => {
    const result = authorize('workout.scheduled_sessions', minted(0, 60 * 24 * 365));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: 'lifetime_too_long',
      lifetimeMs: 365 * 24 * 60 * 60 * 1000,
      maximumMs: MAX_ACCESS_TOKEN_LIFETIME_MS,
    });
  });

  it('refuses a token that expires before it was issued', () => {
    const result = authorize(
      'workout.scheduled_sessions',
      context({
        issuedAt: new Date(NOW.getTime() + 60_000),
        expiresAt: new Date(NOW.getTime() + 30_000),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('invalid_validity_window');
  });

  it('refuses a zero-length validity window', () => {
    const at = new Date(NOW.getTime() + 60_000);
    const result = authorize(
      'workout.scheduled_sessions',
      context({ issuedAt: at, expiresAt: at }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('invalid_validity_window');
  });

  it.each([
    ['issuedAt', { issuedAt: new Date(Number.NaN) }],
    ['expiresAt', { expiresAt: new Date(Number.NaN) }],
  ])('refuses an unparseable %s', (_label, overrides) => {
    const result = authorize('workout.scheduled_sessions', context(overrides));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('invalid_validity_window');
  });

  it('checks the validity window before the scope, so a bad token never reaches scope logic', () => {
    const result = authorize(
      'proposal.replace_plan',
      context({
        scopes: [],
        issuedAt: new Date(NOW.getTime() - 60_000),
        expiresAt: new Date(NOW.getTime() + 60 * 60_000),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('lifetime_too_long');
  });
});

describe('a token is not valid before it was issued', () => {
  /**
   * The validity window was checked for shape (expiry after issuance) and length (at most
   * fifteen minutes), and then only its END was compared with the clock. A token whose
   * window is correctly ordered and exactly fifteen minutes long, but starts years in
   * the future, was never expired and so was authorized today.
   *
   * No clock skew is allowed. A tolerance would be a window in which a token is accepted
   * before it exists; if one is ever needed it must be explicit and tightly bounded, not
   * implied by a missing check.
   */

  const window = (issuedAt: Date, minutes = 15) =>
    context({ issuedAt, expiresAt: new Date(issuedAt.getTime() + minutes * 60_000) });

  it('rejects a well-formed fifteen-minute window that starts years in the future', () => {
    const result = authorize(
      'workout.scheduled_sessions',
      window(new Date('2031-01-01T00:00:00.000Z')),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({
      kind: 'token_not_yet_valid',
      issuedAt: new Date('2031-01-01T00:00:00.000Z'),
    });
  });

  it('rejects a token issued one millisecond after now, with zero skew', () => {
    const result = authorize('workout.scheduled_sessions', window(new Date(NOW.getTime() + 1)));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('token_not_yet_valid');
  });

  it('accepts a token issued exactly now', () => {
    expect(authorize('workout.scheduled_sessions', window(NOW)).ok).toBe(true);
  });

  it('accepts a token issued in the past that has not expired', () => {
    expect(
      authorize('workout.scheduled_sessions', window(new Date(NOW.getTime() - 60_000))).ok,
    ).toBe(true);
  });

  it('declares zero clock skew explicitly', () => {
    expect(ISSUED_AT_CLOCK_SKEW_MS).toBe(0);
  });

  it('rejects a future token before looking at expiry', () => {
    // A future window is by construction not expired, so ordering matters: the answer must
    // name the real problem.
    const result = authorize(
      'workout.scheduled_sessions',
      window(new Date('2031-01-01T00:00:00.000Z')),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).not.toBe('token_expired');
  });

  it('rejects a future token before looking at audience or scope', () => {
    const issuedAt = new Date('2031-01-01T00:00:00.000Z');
    const result = authorize(
      'proposal.replace_plan',
      context({
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + 15 * 60_000),
        audience: 'https://elsewhere.example',
        scopes: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.kind).toBe('token_not_yet_valid');
  });
});
