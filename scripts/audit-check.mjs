#!/usr/bin/env node
/**
 * Dependency vulnerability gate (D-039).
 *
 * Blocks HIGH and CRITICAL advisories. Moderate and below are reported, not
 * blocking, because a gate that cries wolf gets bypassed.
 *
 * Honest about its boundary: `pnpm audit` queries the npm advisory registry, so it
 * needs network access. If it cannot reach the registry the gate FAILS rather than
 * passing on missing data - a vulnerability check that silently checked nothing is
 * worse than no check at all.
 */
import { execFileSync } from 'node:child_process';

const BLOCKING = new Set(['high', 'critical']);

function runAudit() {
  try {
    const raw = execFileSync('pnpm', ['audit', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { raw, offline: false };
  } catch (error) {
    // pnpm audit exits non-zero when advisories exist; that is a normal result.
    const raw = error?.stdout?.toString?.() ?? '';
    const stderr = error?.stderr?.toString?.() ?? '';
    if (raw.trim().startsWith('{')) {
      return { raw, offline: false };
    }
    return { raw: '', offline: true, stderr: stderr || error?.message || String(error) };
  }
}

const { raw, offline, stderr } = runAudit();

if (offline) {
  console.error('audit-check: FAILED — could not reach the advisory registry.');
  console.error(stderr?.split('\n').slice(0, 10).join('\n'));
  console.error(
    '\nThis gate fails closed. A dependency audit that checked nothing must not report success.',
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('audit-check: FAILED — could not parse `pnpm audit --json` output.');
  process.exit(1);
}

const counts = report.metadata?.vulnerabilities ?? {};
const advisories = Object.values(report.advisories ?? {});

const blocking = advisories.filter((advisory) => BLOCKING.has(advisory.severity));

const summary = ['critical', 'high', 'moderate', 'low', 'info']
  .map((level) => `${level}=${counts[level] ?? 0}`)
  .join(' ');

if (blocking.length === 0) {
  console.log(`audit-check: OK — no high or critical advisories. (${summary})`);
  process.exit(0);
}

console.error(`audit-check: FAILED — ${blocking.length} high/critical advisories. (${summary})`);
for (const advisory of blocking.slice(0, 30)) {
  const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []).slice(0, 2);
  console.error(`  [${advisory.severity}] ${advisory.module_name} — ${advisory.title}`);
  console.error(`      ${advisory.url ?? ''}`);
  for (const path of paths) console.error(`      via ${path}`);
}
console.error('\nFix by upgrading. Do not lower the severity threshold to go green (SECURITY.md).');
process.exit(1);
