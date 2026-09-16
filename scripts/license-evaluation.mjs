/**
 * Licence evaluation against the policy and the owner's recorded decisions (R-029).
 *
 * Pure: it takes the two `pnpm licenses list` listings as data, so every rule here is
 * testable without depending on what happens to be installed.
 *
 * The owner approved the current exceptions on 2026-09-16 on conditions, and this is
 * where the conditions that can be checked mechanically are checked:
 *
 *   - an approval covers the EXACT component@version, never a later one;
 *   - the recorded scope must match the tree, runtime being the wider scope;
 *   - the recorded licence expression must still match the installed package;
 *   - the ledger must describe the tree exactly, so a removed, replaced, or no longer
 *     needed component is a material change that forces new review;
 *   - a named approver counts only if a recorded decision by that approver lists the
 *     exact component, carries its conditions, and lasts at least as long;
 *   - a breach of a distribution or modification condition (distribution.mjs) voids it.
 */
import { endOfCalendarDay, evaluateException } from './license-exceptions.mjs';
import { classifySpdx } from './spdx.mjs';

const SCOPES = new Set(['runtime', 'dev']);

/** Yields one {key, expression} per component@version in a `pnpm licenses list` listing. */
function* entriesOf(listingByLicense) {
  for (const [expression, packages] of Object.entries(listingByLicense ?? {})) {
    for (const pkg of packages) {
      const versions = pkg.versions ?? [pkg.version].filter(Boolean);
      for (const version of versions.length ? versions : ['?']) {
        yield { key: `${pkg.name}@${version}`, expression };
      }
    }
  }
}

/**
 * Flattens both listings into one entry per component@version. A package found in the
 * runtime listing is runtime even if it is also a dev dependency, because runtime is
 * the scope with distribution consequences.
 */
function collectTree(runtime, dev) {
  const tree = new Map();
  for (const entry of entriesOf(runtime)) tree.set(entry.key, { ...entry, scope: 'runtime' });
  for (const entry of entriesOf(dev)) {
    if (!tree.has(entry.key)) tree.set(entry.key, { ...entry, scope: 'dev' });
  }
  return tree;
}

/** The recorded decision that backs this exception's approver, if there is one. */
function backingDecision(exception, approvals) {
  return (approvals ?? []).find(
    (decision) =>
      decision.approver === exception.approver &&
      Array.isArray(decision.components) &&
      decision.components.includes(exception.component) &&
      Array.isArray(decision.conditions) &&
      decision.conditions.length > 0 &&
      typeof decision.decision === 'string' &&
      decision.decision.trim() !== '',
  );
}

function emptyViolations() {
  return {
    rejected: [],
    unknown: [],
    review: [],
    badException: [],
    scopeMismatch: [],
    licenseChanged: [],
    staleEntry: [],
    duplicateEntry: [],
    conditionBreach: [],
  };
}

/**
 * Judges one excepted component against its ledger entry.
 * @returns {{violation: [string, object]} | {pending: object} | {}}
 */
function judgeException(record, exception, policy, today) {
  if (exception.spdx !== record.expression) {
    return {
      violation: [
        'licenseChanged',
        { key: record.key, recorded: exception.spdx, actual: record.expression },
      ],
    };
  }
  if (!SCOPES.has(exception.scope)) {
    return { violation: ['badException', { ...record, reason: 'invalid_scope' }] };
  }

  const evaluation = evaluateException(exception, today);
  if (evaluation.status !== 'approved' && evaluation.status !== 'pending_owner') {
    return {
      violation: [
        'badException',
        { ...record, reason: evaluation.status, missing: evaluation.missing },
      ],
    };
  }
  if (exception.scope !== record.scope) {
    return {
      violation: [
        'scopeMismatch',
        { key: record.key, recorded: exception.scope, actual: record.scope },
      ],
    };
  }
  if (evaluation.status === 'pending_owner') {
    return { pending: { ...record, exception } };
  }

  const decision = backingDecision(exception, policy.approvals);
  if (!decision) {
    return { violation: ['badException', { ...record, reason: 'no_recorded_decision' }] };
  }
  const decisionEnd = endOfCalendarDay(String(decision.reviewBy));
  const exceptionEnd = endOfCalendarDay(String(exception.reviewBy));
  if (decisionEnd === undefined || exceptionEnd === undefined || exceptionEnd > decisionEnd) {
    return { violation: ['badException', { ...record, reason: 'outlasts_decision' }] };
  }
  return {};
}

const VERDICT_BUCKET = { rejected: 'rejected', review: 'review', unknown: 'unknown' };

/** Judges one component in the tree, with or without a ledger entry. */
function judgeRecord(record, exception, policy, today) {
  const verdict = classifySpdx(record.expression, policy);
  if (verdict === 'allowed') {
    // An exception for something the policy already allows no longer describes the
    // tree. Leaving it would let it quietly cover a future relicensing.
    return exception
      ? { violation: ['staleEntry', { key: record.key, reason: 'licence now allowed without it' }] }
      : {};
  }
  if (!exception) {
    return { violation: [VERDICT_BUCKET[verdict] ?? 'unknown', record] };
  }
  return judgeException(record, exception, policy, today);
}

/** Indexes the ledger by component, reporting any component listed twice. */
function indexExceptions(entries, violations) {
  const exceptions = new Map();
  for (const entry of entries) {
    if (exceptions.has(entry.component)) {
      violations.duplicateEntry.push({ key: entry.component });
    } else {
      exceptions.set(entry.component, entry);
    }
  }
  return exceptions;
}

/**
 * @param {{
 *   policy: {allowed: string[], rejected: string[], reviewRequired: string[],
 *            exceptions: Record<string, any>[], approvals?: Record<string, any>[]},
 *   runtime: Record<string, any[]>,
 *   dev: Record<string, any[]>,
 *   today: Date,
 *   conditionBreaches?: {condition: string, path: string, detail: string}[],
 * }} input
 */
export function evaluateLicenses({ policy, runtime, dev, today, conditionBreaches = [] }) {
  const violations = emptyViolations();
  const pendingOwner = [];
  const exceptions = indexExceptions(policy.exceptions, violations);
  const tree = collectTree(runtime, dev);

  for (const record of tree.values()) {
    const outcome = judgeRecord(record, exceptions.get(record.key), policy, today);
    if (outcome.violation) violations[outcome.violation[0]].push(outcome.violation[1]);
    if (outcome.pending) pendingOwner.push(outcome.pending);
  }

  violations.staleEntry.push(
    ...[...exceptions.keys()]
      .filter((key) => !tree.has(key))
      .map((key) => ({ key, reason: 'not present in the dependency tree' })),
  );

  // Condition breaches only matter while something relies on an approval.
  if (policy.exceptions.length > 0) {
    violations.conditionBreach.push(...conditionBreaches);
  }

  return { violations, pendingOwner, inspected: tree.size };
}
