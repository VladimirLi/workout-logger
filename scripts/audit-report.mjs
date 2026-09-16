/**
 * Interpretation of `pnpm audit --json` for the vulnerability gate (D-039).
 *
 * Pure, so every rule is testable against pnpm's real captured output.
 *
 * The previous gate accepted any JSON on stdout as a report. When the advisory registry
 * failed, pnpm printed an error envelope - `{"error":{"code":"ERR_PNPM_AUDIT_BAD_RESPONSE",
 * ...}}` - with no advisories and no counts, which the gate read as "zero advisories" and
 * passed. So nothing is trusted by default here. A result is usable only when it is a
 * COMPLETED audit, and a non-zero exit is acceptable only when that completed audit's
 * findings explain it.
 */

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

  const advisoryCount = Object.keys(report.advisories).length;
  const findingCount = SEVERITIES.reduce((sum, severity) => sum + vulnerabilities[severity], 0);
  if ((advisoryCount === 0) !== (findingCount === 0)) {
    return `advisories (${advisoryCount}) and vulnerability counts (${findingCount}) disagree`;
  }
  return undefined;
}

/**
 * @param {{status: number | null, signal: string | null, stdout: string, stderr: string}} run
 * @returns {{ok: true, blocking: object[], counts: Record<string, number>, advisoryCount: number,
 *            totalDependencies: number} | {ok: false, reason: string, detail: string}}
 */
export function interpretAudit({ status, signal, stdout, stderr }) {
  if (status === null || signal) {
    return fail('did_not_complete', `pnpm audit was terminated${signal ? ` by ${signal}` : ''}`);
  }

  const parsed = parseStdout(stdout);
  if (!parsed.ok) {
    return fail(
      parsed.reason,
      [parsed.detail, (stderr ?? '').trim().slice(0, 400)].filter(Boolean).join('\n'),
    );
  }
  const report = parsed.value;

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

  const advisories = Object.values(report.advisories);
  if (status !== 0 && advisories.length === 0) {
    return fail(
      'unexplained_exit',
      `pnpm audit exited ${status} but its completed report contains no advisories to explain it`,
    );
  }

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
