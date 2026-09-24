import { describe, expect, it } from 'vitest';
import type { AuthorizationContext } from './authorization.js';
import {
  assertTokenAbsentFromArgv,
  assertTokenAbsentFromText,
  assertTokenAbsentFromUrl,
  claimsForDiagnostics,
} from './token-hygiene.js';

const SENTINEL = 'mcp_access_token_SENTINEL_do_not_log_6f3a';

const CONTEXT: AuthorizationContext = {
  clientId: 'client_abc',
  scopes: ['workout:read', 'proposal:create'],
  issuedAt: new Date('2026-09-16T12:00:00.000Z'),
  expiresAt: new Date('2026-09-16T12:10:00.000Z'),
  audience: 'https://mcp.gym.vladimirli.com',
};

describe('token hygiene (task 6.5)', () => {
  it('serializes only claim fields for diagnostics', () => {
    const claims = claimsForDiagnostics(CONTEXT);
    expect(Object.keys(claims).sort()).toEqual([
      'audience',
      'clientId',
      'expiresAt',
      'issuedAt',
      'scopes',
    ]);
    const serialized = JSON.stringify(claims);
    expect(assertTokenAbsentFromText(serialized, SENTINEL).ok).toBe(true);
    expect(serialized).not.toMatch(/Bearer|access_token|refresh_token/i);
  });

  it('flags a token planted in log text', () => {
    const logLine = JSON.stringify({
      ...claimsForDiagnostics(CONTEXT),
      authorization: `Bearer ${SENTINEL}`,
    });
    const result = assertTokenAbsentFromText(logLine, SENTINEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.surface).toBe('text');
  });

  it('flags a token planted in a URL', () => {
    const url = `https://mcp.gym.vladimirli.com/callback?access_token=${SENTINEL}`;
    const result = assertTokenAbsentFromUrl(url, SENTINEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.surface).toBe('url');
  });

  it('flags a token planted in process arguments', () => {
    const argv = ['node', 'workout-mcp', `--token=${SENTINEL}`];
    const result = assertTokenAbsentFromArgv(argv, SENTINEL);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.surface).toBe('argv');
  });

  it('accepts clean urls and argv', () => {
    expect(assertTokenAbsentFromUrl('https://mcp.gym.vladimirli.com/tools', SENTINEL).ok).toBe(
      true,
    );
    expect(assertTokenAbsentFromArgv(['node', 'workout-mcp', '--help'], SENTINEL).ok).toBe(true);
  });
});
