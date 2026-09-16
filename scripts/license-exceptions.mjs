/**
 * Licence exception evaluation (R-029).
 *
 * An exception is a recorded legal conclusion. R-029 requires it to carry a NAMED
 * APPROVER, because an agent's licence analysis is not a substitute for a human's.
 * An exception without one is not an exception; it is an unreviewed assumption.
 *
 * So the gate fails closed. Distinct exit codes separate "the tree violates policy"
 * from "the owner has not signed off", because those need different responses and
 * only one of them is a code change.
 */

/** Policy violation: a prohibited or unknown licence is present. Fix the tree. */
export const EXIT_POLICY_VIOLATION = 1;
/** Everything complies, but an exception lacks a named approver. Fix needs a human. */
export const EXIT_BLOCKED_ON_OWNER = 3;

export const PENDING_APPROVER = 'pending-owner-approval';

/** Fields R-029 requires on every exception. A bare entry is a bypass. */
export const REQUIRED_FIELDS = [
  'spdx',
  'scope',
  'use',
  'linkage',
  'noAlternative',
  'obligations',
  'replacementCost',
  'approver',
  'reviewBy',
];

/** Values that look like an approver but name nobody. */
const NON_APPROVERS = new Set(['', 'tbd', 'unknown', 'none', 'n/a', 'agent', PENDING_APPROVER]);

const TWELVE_MONTHS_MS = 366 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The last instant of a `YYYY-MM-DD` date, in UTC.
 *
 * An approval "through 2027-09-16" includes that whole day. Parsing the bare date gives
 * midnight at its START, which would expire the approval a day early. Anything other
 * than a real calendar date is refused, so a timestamp cannot sneak in a different
 * boundary.
 *
 * @param {string} value
 * @returns {number | undefined}
 */
export function endOfCalendarDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = Date.UTC(year, month - 1, day);
  const date = new Date(start);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return start + DAY_MS - 1;
}

/**
 * @param {Record<string, unknown>} exception
 * @param {Date} today
 * @returns {{status: 'approved' | 'incomplete' | 'expired' | 'review_too_far' | 'pending_owner',
 *            missing?: string[]}}
 */
export function evaluateException(exception, today) {
  const missing = REQUIRED_FIELDS.filter((field) => {
    const value = exception[field];
    return typeof value !== 'string' || value.trim() === '';
  });
  if (missing.length > 0) {
    return { status: 'incomplete', missing };
  }

  const reviewByEnd = endOfCalendarDay(String(exception.reviewBy));
  if (reviewByEnd === undefined) {
    return { status: 'incomplete', missing: ['reviewBy'] };
  }
  if (today.getTime() > reviewByEnd) {
    return { status: 'expired' };
  }
  if (reviewByEnd > today.getTime() + TWELVE_MONTHS_MS) {
    return { status: 'review_too_far' };
  }

  if (NON_APPROVERS.has(String(exception.approver).trim().toLowerCase())) {
    return { status: 'pending_owner' };
  }

  return { status: 'approved' };
}
