#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
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
 *
 * Approved advisory waivers are read from docs/advisory-waivers.json (a guardrail file).
 * See ADR-0013 and other waiver records for the rationale and conditions of each waiver.
 */
import { readFileSync } from 'node:fs';
import {
  AUDIT_ARGS,
  auditConfigProblem,
  filterByWaivers,
  interpretAudit,
} from './audit-report.mjs';

const config = spawnSync('pnpm', ['config', 'get', '--json', 'auditConfig'], { encoding: 'utf8' });
const configText = (config.stdout ?? '').trim();
let auditConfig;
try {
  auditConfig =
    configText === '' || configText === 'undefined' ? undefined : JSON.parse(configText);
} catch {
  console.error(`audit-check: FAILED — could not read the effective auditConfig: ${configText}`);
  process.exit(1);
}
const configProblem = auditConfigProblem(auditConfig);
if (config.status !== 0 || configProblem) {
  console.error(
    `audit-check: FAILED — ${configProblem ?? 'could not read the effective auditConfig'}.`,
  );
  console.error('Silencing an advisory is a guardrail decision (SECURITY.md), not configuration.');
  process.exit(1);
}

const run = spawnSync('pnpm', [...AUDIT_ARGS], {
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

let waivers = [];
try {
  const waiverPath = new URL('../docs/advisory-waivers.json', import.meta.url).pathname;
  const waiverText = readFileSync(waiverPath, 'utf8');
  waivers = JSON.parse(waiverText);
} catch (error) {
  // No waivers file or parse error; treat as empty waiver list
  if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
    console.error(`audit-check: warning — could not load waivers: ${error.message}`);
  }
}

const { unwaived, waived } = filterByWaivers(result.blocking, waivers);

if (unwaived.length === 0) {
  const waivedNote = waived.length > 0 ? ` (${waived.length} approved waiver(s) applied)` : '';
  console.log(
    `audit-check: OK — completed audit of ${result.totalDependencies} dependencies, ` +
      `no unwaived high or critical advisories. (${summary})${waivedNote}`,
  );
  process.exit(0);
}

const unwaivedLabel = waived.length > 0 ? 'unwaived ' : '';
console.error(
  `audit-check: FAILED — ${unwaived.length} ${unwaivedLabel}high/critical advisories. (${summary})`,
);
for (const advisory of unwaived.slice(0, 30)) {
  const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []).slice(0, 2);
  console.error(`  [${advisory.severity}] ${advisory.module_name} — ${advisory.title}`);
  console.error(`      ${advisory.url ?? ''}`);
  for (const path of paths) console.error(`      via ${path}`);
}

if (waived.length > 0) {
  console.error(`\n${waived.length} approved advisory waiver(s):`);
  for (const advisory of waived) {
    console.error(
      `  • [${advisory.severity}] ${advisory.module_name} (${advisory.url?.split('/').pop()})`,
    );
  }
}

console.error('\nFix by upgrading. Do not lower the severity threshold to go green (SECURITY.md).');
process.exit(1);
