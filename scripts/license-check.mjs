#!/usr/bin/env node
/**
 * License gate (R-029, docs/license-policy.md).
 *
 * Reads `pnpm licenses list --json`, which resolves from the committed lockfile and the
 * installed store. No network, no extra dependency. The rules live in
 * license-evaluation.mjs and distribution.mjs, which are pure and tested with fixtures.
 *
 * Exit codes, because the two failures need different responses:
 *
 *   1 - POLICY VIOLATION. A prohibited or unresolvable licence, an exception that is
 *       incomplete, expired, unbacked by a recorded decision, pinned to a different
 *       version, scope or licence than the tree, stale, or duplicated - or a breach of
 *       the approval conditions (distribution, modified dependencies). The tree no
 *       longer matches what was approved.
 *   3 - BLOCKED ON OWNER. Everything matches, but an exception has no named approver.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRepositoryInputs, detectApprovalConditionBreaches } from './distribution.mjs';
import { evaluateLicenses } from './license-evaluation.mjs';
import { EXIT_BLOCKED_ON_OWNER, EXIT_POLICY_VIOLATION } from './license-exceptions.mjs';
import { parseLicenseListing } from './license-listing.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(HERE, 'license-policy.json'), 'utf8'));

function fail(message, detail) {
  console.error(`license-check: ${message}`);
  if (detail) console.error(detail);
  console.error('This gate fails rather than passing on missing data.');
  process.exit(EXIT_POLICY_VIOLATION);
}

function readLicenses(scope) {
  const args = ['licenses', 'list', '--json', '--long', scope];
  let raw;
  try {
    raw = execFileSync('pnpm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // pnpm exits non-zero for a scope with no dependencies, printing a plain-text
    // notice rather than JSON. Its stdout still carries the answer.
    raw = error?.stdout?.toString?.() ?? '';
    if (raw.trim() === '') {
      fail(
        `could not read licenses (pnpm ${args.join(' ')}).`,
        error?.stderr?.toString?.() ?? error?.message ?? String(error),
      );
    }
  }
  const parsed = parseLicenseListing(raw);
  if (!parsed.ok) fail(`could not read licenses (pnpm ${args.join(' ')}).`, parsed.reason);
  return parsed.listing;
}

const conditionBreaches = detectApprovalConditionBreaches(
  collectRepositoryInputs(policy.exceptions),
);

const { violations, pendingOwner, inspected } = evaluateLicenses({
  policy,
  runtime: readLicenses('--prod'),
  dev: readLicenses('--dev'),
  today: new Date(),
  conditionBreaches,
});

const SECTIONS = [
  [
    'conditionBreach',
    'APPROVAL CONDITIONS BREACHED — the owner approval no longer holds; new review required',
  ],
  ['rejected', 'Prohibited licences'],
  ['unknown', 'Unresolved or unknown licences (treated as prohibited)'],
  ['review', 'Licences requiring review with no exception for this exact version'],
  ['licenseChanged', 'Excepted component whose licence no longer matches the ledger'],
  ['scopeMismatch', 'Excepted component whose scope no longer matches the ledger'],
  ['staleEntry', 'Ledger entries that no longer describe the tree (material dependency change)'],
  ['duplicateEntry', 'Duplicate ledger entries'],
  [
    'badException',
    'Exceptions that are incomplete, expired, unbacked by a recorded decision, or outlast it',
  ],
];

function describe(record) {
  if (record.condition) return `${record.condition}: ${record.path} — ${record.detail}`;
  const parts = [record.key];
  if (record.expression) parts.push(`[${record.expression}]`);
  if (record.scope) parts.push(`(${record.scope})`);
  if (record.recorded !== undefined)
    parts.push(`recorded=${record.recorded} actual=${record.actual}`);
  if (record.reason)
    parts.push(`[${record.reason}${record.missing ? `: ${record.missing.join(', ')}` : ''}]`);
  return parts.join('  ');
}

const violationCount = Object.values(violations).reduce((sum, list) => sum + list.length, 0);

if (violationCount > 0) {
  console.error('license-check: FAILED — the dependency tree does not match the approved policy');
  for (const [key, label] of SECTIONS) {
    const records = violations[key];
    if (records.length === 0) continue;
    console.error(`\n${label} (${records.length}):`);
    for (const record of records.slice(0, 50)) console.error(`  ${describe(record)}`);
    if (records.length > 50) console.error(`  ... and ${records.length - 50} more`);
  }
  console.error(
    '\nSee docs/license-policy.md. Do not widen the allowlist, and do not edit an approved' +
      '\nentry to match a new version or scope: that is a new decision for the owner.',
  );
  process.exit(EXIT_POLICY_VIOLATION);
}

if (pendingOwner.length > 0) {
  console.error('license-check: BLOCKED: owner approval required');
  console.error(
    `\n${pendingOwner.length} licence exception(s) carry a completed analysis but no named` +
      '\napprover backed by a recorded decision. R-029 requires one.\n',
  );
  const width = Math.max(...pendingOwner.map(({ key }) => key.length));
  for (const { key, expression, scope, exception } of pendingOwner.sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    console.error(`  ${key.padEnd(width)}  ${scope.padEnd(7)} ${expression}`);
    console.error(`  ${' '.repeat(width)}  present: ${exception.use}`);
    console.error(`  ${' '.repeat(width)}  linkage: ${exception.linkage}`);
    console.error(`  ${' '.repeat(width)}  if removed: ${exception.replacementCost}\n`);
  }
  console.error('Full analysis: docs/license-policy.md. Gate: docs/external-gates.md, G-11.');
  process.exit(EXIT_BLOCKED_ON_OWNER);
}

const approved = policy.exceptions.length;
console.log(
  `license-check: OK — ${inspected} components; ${approved} exception(s) match their ` +
    'recorded owner decision by exact version, scope and licence; no approval condition breached.',
);
