#!/usr/bin/env node
/**
 * Dependency vulnerability gate (D-039).
 *
 * Blocks HIGH and CRITICAL advisories. Moderate and below are reported, not blocking,
 * because a gate that cries wolf gets bypassed.
 *
 * Fails closed on anything that is not a completed audit: a registry error envelope, an
 * incomplete report, unparseable output, a terminated process, or a non-zero exit the
 * completed report does not explain. `pnpm audit` needs the advisory registry, so an
 * offline machine fails this gate - a vulnerability check that silently checked nothing
 * is worse than no check at all. The rules live in audit-report.mjs.
 */
import { spawnSync } from 'node:child_process';
import { interpretAudit } from './audit-report.mjs';

const run = spawnSync('pnpm', ['audit', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (run.error) {
  console.error(`audit-check: FAILED — could not run pnpm audit: ${run.error.message}`);
  process.exit(1);
}

const result = interpretAudit({
  status: run.status,
  signal: run.signal,
  stdout: run.stdout,
  stderr: run.stderr,
});

if (!result.ok) {
  console.error(`audit-check: FAILED — no completed audit (${result.reason}).`);
  console.error(result.detail);
  console.error(
    '\nThis gate fails closed. A dependency audit that did not complete must not report success.',
  );
  process.exit(1);
}

const summary = Object.entries(result.counts)
  .reverse()
  .map(([level, count]) => `${level}=${count}`)
  .join(' ');

if (result.blocking.length === 0) {
  console.log(
    `audit-check: OK — completed audit of ${result.totalDependencies} dependencies, ` +
      `no high or critical advisories. (${summary})`,
  );
  process.exit(0);
}

console.error(
  `audit-check: FAILED — ${result.blocking.length} high/critical advisories. (${summary})`,
);
for (const advisory of result.blocking.slice(0, 30)) {
  const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []).slice(0, 2);
  console.error(`  [${advisory.severity}] ${advisory.module_name} — ${advisory.title}`);
  console.error(`      ${advisory.url ?? ''}`);
  for (const path of paths) console.error(`      via ${path}`);
}
console.error('\nFix by upgrading. Do not lower the severity threshold to go green (SECURITY.md).');
process.exit(1);
