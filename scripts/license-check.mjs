#!/usr/bin/env node
/**
 * License gate (R-029, docs/license-policy.md).
 *
 * Reads `pnpm licenses list --json`, which resolves from the committed lockfile and
 * the installed store. No network, no extra dependency.
 *
 * Two independent ways to fail, with different exit codes because they need
 * different responses:
 *
 *   1 - POLICY VIOLATION. A prohibited or unresolvable licence is in the tree, or an
 *       exception is incomplete or expired. This is a code change.
 *   3 - BLOCKED ON OWNER. Everything complies, but an exception has no named
 *       approver. No amount of engineering clears this; a human must decide.
 *
 * An UNKNOWN licence is a failure, not a warning. A dependency whose licence cannot
 * be determined is prohibited until someone determines it.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXIT_BLOCKED_ON_OWNER,
  EXIT_POLICY_VIOLATION,
  evaluateException,
} from './license-exceptions.mjs';
import { parseLicenseListing } from './license-listing.mjs';
import { classifySpdx } from './spdx.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(readFileSync(join(HERE, 'license-policy.json'), 'utf8'));

const exceptions = new Map(policy.exceptions.map((entry) => [entry.component, entry]));

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
      console.error(`license-check: could not read licenses (pnpm ${args.join(' ')}).`);
      console.error(error?.stderr?.toString?.() ?? error?.message ?? String(error));
      console.error('This gate fails rather than passing on missing data.');
      process.exit(EXIT_POLICY_VIOLATION);
    }
  }

  const parsed = parseLicenseListing(raw);
  if (!parsed.ok) {
    console.error(`license-check: could not read licenses (pnpm ${args.join(' ')}).`);
    console.error(parsed.reason);
    console.error('This gate fails rather than passing on missing data.');
    process.exit(EXIT_POLICY_VIOLATION);
  }
  return parsed.listing;
}

const today = new Date();
const problems = { rejected: [], review: [], unknown: [], badException: [] };
const pendingOwner = [];
let inspected = 0;

// Runtime (shipped) and dev tooling are evaluated separately (R-029).
for (const scope of ['--prod', '--dev']) {
  const byLicense = readLicenses(scope);
  const isRuntime = scope === '--prod';

  for (const [expression, packages] of Object.entries(byLicense)) {
    const verdict = classifySpdx(expression, policy);
    for (const pkg of packages) {
      inspected += 1;
      const versions = pkg.versions ?? [pkg.version].filter(Boolean);
      for (const version of versions.length ? versions : ['?']) {
        const key = `${pkg.name}@${version}`;
        const record = { key, expression, scope: isRuntime ? 'runtime' : 'dev' };

        if (verdict === 'allowed') continue;

        const exception = exceptions.get(key);
        if (exception) {
          const evaluation = evaluateException(exception, today);
          if (evaluation.status === 'approved') continue;
          if (evaluation.status === 'pending_owner') {
            pendingOwner.push({ ...record, exception });
            continue;
          }
          problems.badException.push({ ...record, reason: evaluation.status, ...evaluation });
          continue;
        }

        if (verdict === 'rejected') problems.rejected.push(record);
        else if (verdict === 'unknown') problems.unknown.push(record);
        else if (verdict === 'review') problems.review.push(record);
      }
    }
  }
}

function report(label, records) {
  if (records.length === 0) return;
  console.error(`\n${label} (${records.length}):`);
  for (const record of records.slice(0, 50)) {
    const extra = record.reason
      ? `  [${record.reason}${record.missing ? `: ${record.missing.join(', ')}` : ''}]`
      : '';
    console.error(`  ${record.key}  [${record.expression}]  (${record.scope})${extra}`);
  }
  if (records.length > 50) console.error(`  ... and ${records.length - 50} more`);
}

const violations =
  problems.rejected.length +
  problems.unknown.length +
  problems.review.length +
  problems.badException.length;

if (violations > 0) {
  console.error('license-check: FAILED — policy violation');
  report('Prohibited licenses', problems.rejected);
  report('Unresolved or unknown licenses (treated as prohibited)', problems.unknown);
  report('Licenses requiring review with no recorded exception', problems.review);
  report('Exceptions that are incomplete, expired, or dated too far out', problems.badException);
  console.error('\nSee docs/license-policy.md. Do not widen the allowlist to make this pass.');
  process.exit(EXIT_POLICY_VIOLATION);
}

if (pendingOwner.length > 0) {
  console.error('license-check: BLOCKED: owner approval required');
  console.error(
    `\n${pendingOwner.length} licence exception(s) carry a completed analysis but no named\n` +
      "approver. R-029 requires one. An agent's licence conclusion is not a substitute for\n" +
      "the owner's, so this gate fails closed rather than reminding.\n",
  );
  console.error('Decision ledger — approve or reject each, then set `approver` in');
  console.error('scripts/license-policy.json. Full analysis: docs/license-policy.md.\n');

  const width = Math.max(...pendingOwner.map(({ key }) => key.length));
  for (const { key, expression, scope, exception } of pendingOwner.sort((a, b) =>
    a.key.localeCompare(b.key),
  )) {
    console.error(`  ${key.padEnd(width)}  ${scope.padEnd(7)} ${expression}`);
    console.error(`  ${' '.repeat(width)}  present: ${exception.use}`);
    console.error(`  ${' '.repeat(width)}  linkage: ${exception.linkage}`);
    console.error(`  ${' '.repeat(width)}  if removed: ${exception.replacementCost}`);
    console.error('');
  }
  console.error(
    'Every analysis assumes this product is NOT DISTRIBUTED: privately hosted,\n' +
      'single-user, no published package. Publishing invalidates all of them.\n',
  );
  process.exit(EXIT_BLOCKED_ON_OWNER);
}

console.log(`license-check: OK — ${inspected} package entries, all licenses accounted for.`);
