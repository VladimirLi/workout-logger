import { describe, expect, it } from 'vitest';
import { parseLicenseListing } from './license-listing.mjs';

/**
 * `pnpm licenses list --json --prod` does not always emit JSON. When a scope has no
 * dependencies at all it prints the plain string `No license information available`.
 *
 * That is not missing data - it is an empty set, and an empty set has nothing to
 * violate. The gate used to treat it as unreadable output and fail, which meant a
 * tree with no production dependencies could not pass a licence check it trivially
 * satisfied.
 *
 * The distinction matters in the other direction too: anything else unparseable must
 * still fail, because a licence check that silently checked nothing is worse than no
 * check.
 */

describe('empty scopes', () => {
  it.each([
    'No license information available',
    'No license information available\n',
    '  No license information available  ',
    'No licenses in packages found',
    'No licenses in packages found\n',
    'no licenses in packages found',
  ])('reads %j as an empty listing', (raw) => {
    expect(parseLicenseListing(raw)).toEqual({ ok: true, listing: {} });
  });

  it('reads empty output as an empty listing', () => {
    expect(parseLicenseListing('')).toEqual({ ok: true, listing: {} });
    expect(parseLicenseListing('   \n ')).toEqual({ ok: true, listing: {} });
  });
});

describe('real listings', () => {
  it('parses a JSON listing', () => {
    const raw = JSON.stringify({ MIT: [{ name: 'left-pad', versions: ['1.0.0'] }] });
    expect(parseLicenseListing(raw)).toEqual({
      ok: true,
      listing: { MIT: [{ name: 'left-pad', versions: ['1.0.0'] }] },
    });
  });
});

describe('genuinely unreadable output still fails', () => {
  it.each([
    'Error: could not resolve the store',
    'No lockfile found',
    'No such file or directory',
    '{"MIT": [',
    'ERR_PNPM_NO_LOCKFILE  Cannot install with frozen-lockfile',
    'null',
    '[]',
    '"a string"',
  ])('refuses to interpret %j as an empty listing', (raw) => {
    expect(parseLicenseListing(raw).ok).toBe(false);
  });

  it('never returns a listing when it cannot parse', () => {
    const result = parseLicenseListing('not json at all');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('not json at all');
  });
});
