/**
 * Parsing for `pnpm licenses list --json` output.
 *
 * pnpm prints a plain-text notice - `No licenses in packages found`, or
 * `No license information available` depending on version - when a scope has no
 * dependencies, rather than an empty JSON object. That is an empty set, not
 * missing data, and treating it as unreadable made a tree with no production
 * dependencies fail a check it trivially satisfied.
 *
 * Everything else that fails to parse still fails, because a licence check that
 * silently checked nothing is worse than no check at all.
 */

/**
 * pnpm's plain-text notices for a scope with nothing in it. Anchored and enumerated
 * rather than a loose "starts with No" match, so an error message that happens to
 * begin with the same word is not read as an empty set.
 */
const EMPTY_LISTING = /^no licen[cs]e(s)? (information available|in packages found)$/i;

/**
 * @param {string} raw
 * @returns {{ok: true, listing: Record<string, unknown[]>} | {ok: false, reason: string}}
 */
export function parseLicenseListing(raw) {
  const text = (raw ?? '').trim();

  if (text === '' || EMPTY_LISTING.test(text)) {
    return { ok: true, listing: {} };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      reason: `${error instanceof Error ? error.message : String(error)}: ${text.slice(0, 200)}`,
    };
  }

  // A listing is an object keyed by SPDX expression. An array, null or a scalar is
  // not one, and guessing what it meant is exactly the failure mode to avoid.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: `expected an object keyed by licence, got ${text.slice(0, 200)}` };
  }

  return { ok: true, listing: parsed };
}
