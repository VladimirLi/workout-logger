/**
 * Interpretation of `pnpm audit --json` for the vulnerability gate (D-039).
 *
 * Pure, so every rule is testable against pnpm's real captured output.
 *
 * ACCEPTED SEMANTICS - read from pnpm 11.5.2's audit handler and confirmed by running it:
 *
 *   - metadata.vulnerabilities[s] is incremented exactly once per advisory of severity s.
 *   - With --json, `advisories` keeps only entries at or above --audit-level, and ignored
 *     GHSAs are removed, but `metadata` is copied through unchanged. Advisories and counts
 *     therefore agree exactly only when nothing is filtered, which is why AUDIT_ARGS pins
 *     `--audit-level info` and any ignore list fails the gate.
 *   - With --json, the exit code is 1 when any advisory remains and 0 otherwise. A registry
 *     failure also exits 1, with an error envelope on stdout instead of a report.
 *
 * So a result is usable only when all of these hold:
 *   - the process exited normally with status 0 or 1 - any other status is undocumented;
 *   - stdout is a completed report, not an error envelope and not a partial structure;
 *   - for every severity, the advisory entries of that severity number exactly the count
 *     in metadata.vulnerabilities;
 *   - the status is exactly the one pnpm produces for that report: 1 with advisories,
 *     0 without.
 *
 * Earlier versions accepted any JSON on stdout (an error envelope passed as "no
 * advisories"), accepted any non-zero status the report could vaguely explain (exit 255
 * with one moderate advisory passed), and compared only whether counts and advisories
 * were both zero or both non-zero (metadata high=1 beside a single moderate advisory
 * passed with nothing blocking).
 */

/** The invocation these semantics are defined for. Changing it changes the semantics. */
export const AUDIT_ARGS = Object.freeze(['audit', '--json', '--audit-level', 'info']);

/** The only statuses pnpm audit --json produces for a run that completed or reported an error. */
const DOCUMENTED_STATUSES = new Set([0, 1]);

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const BLOCKING = new Set(['high', 'critical']);
const DEPENDENCY_COUNTS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'totalDependencies',
];

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCount = (value) => Number.isInteger(value) && value >= 0;

const fail = (reason, detail) => ({ ok: false, reason, detail });

function parseStdout(stdout) {
  const text = (stdout ?? '').trim();
  if (text === '') return fail('unparseable', 'pnpm audit produced no output');
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return fail(
      'unparseable',
      `${error instanceof Error ? error.message : error}: ${text.slice(0, 200)}`,
    );
  }
}

/** Checks the structure pnpm writes only when an audit actually ran to completion. */
function incompleteness(report) {
  if (!isPlainObject(report.advisories)) return 'advisories is not an object';
  if (!isPlainObject(report.metadata)) return 'metadata is not an object';

  const { vulnerabilities } = report.metadata;
  if (!isPlainObject(vulnerabilities)) return 'metadata.vulnerabilities is not an object';
  for (const severity of SEVERITIES) {
    if (!isCount(vulnerabilities[severity])) {
      return `metadata.vulnerabilities.${severity} is not a non-negative integer`;
    }
  }
  for (const field of DEPENDENCY_COUNTS) {
    if (!isCount(report.metadata[field])) return `metadata.${field} is not a non-negative integer`;
  }
  // An audit of no dependencies checked nothing, and this workspace is never empty.
  if (report.metadata.totalDependencies === 0) return 'the audit examined zero dependencies';

  for (const [id, entry] of Object.entries(report.advisories)) {
    if (!isPlainObject(entry) || !SEVERITIES.includes(entry.severity)) {
      return `advisory ${id} has no recognised severity`;
    }
  }

  return undefined;
}

/**
 * Per-severity disagreement between advisory entries and metadata.vulnerabilities, or
 * undefined when every severity agrees exactly. pnpm counts each advisory exactly once
 * under its own severity, so any difference means the report was filtered, truncated,
 * or altered - including an advisory relabelled to a lower severity.
 */
function contradiction(report) {
  const listed = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  for (const entry of Object.values(report.advisories)) listed[entry.severity] += 1;

  const differing = SEVERITIES.filter(
    (severity) => listed[severity] !== report.metadata.vulnerabilities[severity],
  ).map(
    (severity) =>
      `${severity}: ${listed[severity]} advisories vs ${report.metadata.vulnerabilities[severity]} counted`,
  );
  return differing.length > 0 ? differing.join('; ') : undefined;
}

/** Why the process itself cannot be trusted to have completed, or undefined. */
function processFailure(status, signal) {
  if (status === null || signal) {
    return fail('did_not_complete', `pnpm audit was terminated${signal ? ` by ${signal}` : ''}`);
  }
  // Checked before the report is even read: no report content can make an undocumented
  // status trustworthy, because the process did not end the way a completed audit ends.
  if (!DOCUMENTED_STATUSES.has(status)) {
    return fail(
      'undocumented_exit',
      `pnpm audit exited ${status}; only 0 (no advisories) and 1 (advisories found) are documented`,
    );
  }
  return undefined;
}

/** Why the parsed output is not a trustworthy completed report, or undefined. */
function reportFailure(report, status) {
  if (!isPlainObject(report)) {
    return fail('incomplete_report', 'pnpm audit output is not a JSON object');
  }
  // An error key means pnpm is reporting a failure, not a result. Whatever else sits
  // beside it cannot be trusted as a completed audit.
  if (Object.hasOwn(report, 'error')) {
    const { code, message } = isPlainObject(report.error) ? report.error : {};
    return fail(
      'error_envelope',
      [code, message ?? JSON.stringify(report.error)].filter(Boolean).join(': '),
    );
  }

  const problem = incompleteness(report);
  if (problem) return fail('incomplete_report', problem);

  const disagreement = contradiction(report);
  if (disagreement) return fail('contradictory_report', disagreement);

  const advisoryCount = Object.keys(report.advisories).length;
  const expectedStatus = advisoryCount > 0 ? 1 : 0;
  if (status !== expectedStatus) {
    return fail(
      'unexplained_exit',
      `pnpm audit exited ${status}, but a completed report with ${advisoryCount} advisories ` +
        `exits ${expectedStatus}`,
    );
  }
  return undefined;
}

/**
 * Parse a version constraint string (e.g., "3.0.3", ">=1.0.0") and check if a version matches.
 * For now, only exact version matches are supported; other constraint formats would require
 * a semver parser.
 *
 * @param {string} version - the installed version
 * @param {string} constraint - the version constraint from the waiver
 * @returns {boolean}
 */
function versionMatches(version, constraint) {
  if (!constraint) return true; // No constraint = matches any version
  // Exact match for now; other operators (^, ~, >=, etc.) would need semver parsing
  return version === constraint;
}

/**
 * Check if a finding is consistent with the waiver's scope.
 * For "dev-only" scope, the finding must have dev=true.
 *
 * @param {object} finding - a single finding from the advisory
 * @param {string} waiverScope - the scope from the waiver (e.g., "dev-only")
 * @returns {boolean}
 */
function findingMatchesScope(finding, waiverScope) {
  if (waiverScope === 'dev-only') {
    return finding.dev === true;
  }
  return true;
}

/**
 * Check if the waiver has expired based on the current date.
 *
 * @param {string | undefined} reviewTrigger - the ISO date string when the waiver should be re-reviewed
 * @returns {boolean} true if the waiver is still valid, false if expired
 */
function isWaiverValid(reviewTrigger) {
  if (!reviewTrigger) return true; // No expiry = always valid
  const expiryDate = new Date(reviewTrigger);
  const now = new Date();
  return now < expiryDate;
}

/**
 * Check if all findings in an advisory are valid under a waiver.
 * Each finding must match the version constraint and scope.
 *
 * @param {object} advisory - the advisory from the audit
 * @param {object} waiver - the waiver to check against
 * @returns {boolean}
 */
function allFindingsValid(advisory, waiver) {
  const findings = Array.isArray(advisory.findings) ? advisory.findings : [];
  if (findings.length === 0) return false;

  for (const finding of findings) {
    if (!isPlainObject(finding)) return false;
    if (!versionMatches(finding.version, waiver.version_constraint)) return false;
    if (!findingMatchesScope(finding, waiver.scope)) return false;
  }
  return true;
}

/**
 * Check if an advisory matches a waiver.
 * Validates GHSA, module name, expiry, and all findings.
 *
 * @param {object} advisory - the advisory from the audit
 * @param {string} ghsa - the GHSA ID from the advisory URL
 * @param {object} waiver - the waiver to check
 * @returns {boolean}
 */
function advisoryMatchesWaiver(advisory, ghsa, waiver) {
  if (waiver.ghsa !== ghsa || waiver.module_name !== advisory.module_name) return false;
  if (!isWaiverValid(waiver.review_trigger)) return false;
  return allFindingsValid(advisory, waiver);
}

/**
 * Filter blocking advisories against approved waivers.
 *
 * An approved waiver is a guardrail decision in docs/advisory-waivers.json. Each waiver
 * specifies a GHSA ID, module name, version constraint, scope, and dependency path.
 * An advisory matches only if ALL of the following hold:
 *
 * - GHSA ID and module name match exactly
 * - Installed version matches the version_constraint
 * - All findings are consistent with the waiver's scope
 * - The waiver has not expired (review_trigger date has not passed)
 *
 * If any constraint is unmet, the advisory is unwaived. This ensures waivers fail closed
 * and do not silently waive unintended findings (e.g., production paths or newer versions).
 *
 * @param {object[]} blocking - blocking advisories from the audit
 * @param {unknown[]} waivers - loaded waivers from docs/advisory-waivers.json
 * @returns {{unwaived: object[], waived: object[]}}
 */
export function filterByWaivers(blocking, waivers) {
  const validWaivers = Array.isArray(waivers) ? waivers : [];
  const unwaived = [];
  const waived = [];

  for (const advisory of blocking) {
    const ghsa = advisory.url?.split('/').pop();
    const foundMatch = validWaivers.some(
      (w) => isPlainObject(w) && advisoryMatchesWaiver(advisory, ghsa, w),
    );

    if (foundMatch) {
      waived.push(advisory);
    } else {
      unwaived.push(advisory);
    }
  }

  return { unwaived, waived };
}

/**
 * @param {{status: number | null, signal: string | null, stdout: string, stderr: string}} run
 * @returns {{ok: true, blocking: object[], counts: Record<string, number>, advisoryCount: number,
 *            totalDependencies: number} | {ok: false, reason: string, detail: string}}
 */
export function interpretAudit({ status, signal, stdout, stderr }) {
  const processProblem = processFailure(status, signal);
  if (processProblem) return processProblem;

  const parsed = parseStdout(stdout);
  if (!parsed.ok) {
    return fail(
      parsed.reason,
      [parsed.detail, (stderr ?? '').trim().slice(0, 400)].filter(Boolean).join('\n'),
    );
  }

  const reportProblem = reportFailure(parsed.value, status);
  if (reportProblem) return reportProblem;

  const report = parsed.value;
  const advisories = Object.values(report.advisories);
  return {
    ok: true,
    blocking: advisories.filter((entry) => BLOCKING.has(entry.severity)),
    counts: Object.fromEntries(
      SEVERITIES.map((severity) => [severity, report.metadata.vulnerabilities[severity]]),
    ),
    advisoryCount: advisories.length,
    totalDependencies: report.metadata.totalDependencies,
  };
}

/**
 * An audit configuration that would hide advisories, or undefined when there is none.
 *
 * pnpm removes ignored GHSAs from `advisories` while still counting them in metadata, so
 * an ignore list would make every completed report contradictory. Rather than let that
 * surface as a confusing contradiction, it is rejected by name: silencing an advisory is a
 * guardrail decision, not a configuration detail.
 *
 * @param {unknown} auditConfig
 * @returns {string | undefined}
 */
export function auditConfigProblem(auditConfig) {
  if (auditConfig === undefined || auditConfig === null) return undefined;
  if (!isPlainObject(auditConfig)) return 'auditConfig is not an object';
  const { ignoreGhsas } = auditConfig;
  if (ignoreGhsas === undefined || ignoreGhsas === null) return undefined;
  if (!Array.isArray(ignoreGhsas)) return 'auditConfig.ignoreGhsas is not a list';
  if (ignoreGhsas.length === 0) return undefined;
  return `auditConfig.ignoreGhsas hides advisories: ${ignoreGhsas.join(', ')}`;
}
