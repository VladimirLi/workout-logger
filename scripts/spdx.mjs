/**
 * SPDX expression classification for the licence gate (R-029).
 *
 * Deliberately unclever. It understands exactly four shapes:
 *
 *   - a bare identifier                    `MIT`
 *   - `A WITH B`                           classified by A
 *   - a pure disjunction                   `A OR B OR C`
 *   - a pure conjunction                   `A AND B AND C`
 *
 * Anything else - mixed operators, parentheses, free text - is UNKNOWN, which the
 * policy treats as prohibited.
 *
 * The previous version stripped parentheses, split on both operators, and decided
 * "is this a disjunction?" by testing the whole string for the word OR. That made
 * `(MIT OR GPL-3.0-only) AND CC-BY-4.0` come out allowed: it saw an OR and found
 * MIT, and the AND - which makes every conjunct's obligations apply - was ignored.
 *
 * Failing closed on an expression we do not fully understand is the only safe
 * default, because the alternative is shipping under obligations nobody read.
 */

/** @typedef {{allowed: string[], rejected: string[], reviewRequired: string[]}} LicensePolicy */
/** @typedef {'allowed' | 'rejected' | 'review' | 'unknown'} Verdict */

const OPERATOR = /\s+(AND|OR)\s+/;

/**
 * Returns the expression with one layer of fully wrapping parentheses removed, or
 * `undefined` if the parentheses are anything other than a single redundant wrapper.
 */
function unwrapRedundantParentheses(text) {
  if (!text.includes('(') && !text.includes(')')) return text;
  if (!text.startsWith('(') || !text.endsWith(')')) return undefined;
  const inner = text.slice(1, -1).trim();
  // A nested or re-opened group is real structure; refuse it.
  if (inner.includes('(') || inner.includes(')')) return undefined;
  return inner;
}

/** Strips a `WITH <exception>` suffix; the licence decides, not the exception. */
function baseLicense(term) {
  const parts = term.split(/\s+WITH\s+/);
  return parts.length <= 2 ? parts[0].trim() : undefined;
}

function classifyTerm(term, policy) {
  const id = baseLicense(term);
  if (!id) return 'unknown';
  if (policy.rejected.includes(id)) return 'rejected';
  if (policy.allowed.includes(id)) return 'allowed';
  if (policy.reviewRequired.includes(id)) return 'review';
  return 'unknown';
}

/**
 * Splits an expression into its operator and terms, or returns `undefined` when the
 * shape is one this parser does not model.
 *
 * @param {string} text
 * @returns {{operator: 'AND' | 'OR' | undefined, terms: string[]} | undefined}
 */
function parseExpression(text) {
  const inner = unwrapRedundantParentheses(text);
  if (inner === undefined) return undefined;

  const operators = [...inner.matchAll(/\s+(AND|OR)\s+/g)].map((match) => match[1]);
  // Mixed AND and OR without grouping is ambiguous to us.
  if (new Set(operators).size > 1) return undefined;

  const terms = inner.split(OPERATOR).filter((part) => part !== 'AND' && part !== 'OR');
  if (terms.length !== operators.length + 1) return undefined;
  if (terms.some((term) => term.trim() === '')) return undefined;

  return { operator: operators[0], terms: terms.map((term) => term.trim()) };
}

/** A choice of licence: we may take any one of them. */
function classifyDisjunction(verdicts) {
  if (verdicts.includes('allowed')) return 'allowed';
  if (verdicts.includes('review')) return 'review';
  if (verdicts.every((verdict) => verdict === 'rejected')) return 'rejected';
  return 'unknown';
}

/** A bare term, or a conjunction: every obligation applies. */
function classifyConjunction(verdicts) {
  if (verdicts.includes('rejected')) return 'rejected';
  if (verdicts.includes('unknown')) return 'unknown';
  if (verdicts.includes('review')) return 'review';
  return 'allowed';
}

/**
 * @param {string | undefined} expression
 * @param {LicensePolicy} policy
 * @returns {Verdict}
 */
export function classifySpdx(expression, policy) {
  const text = (expression ?? '').trim();
  if (text === '' || /^unknown$/i.test(text)) return 'unknown';

  const parsed = parseExpression(text);
  if (!parsed) return 'unknown';

  const verdicts = parsed.terms.map((term) => classifyTerm(term, policy));
  return parsed.operator === 'OR' ? classifyDisjunction(verdicts) : classifyConjunction(verdicts);
}
