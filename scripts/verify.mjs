#!/usr/bin/env node
/**
 * The aggregate gate (R-028, ADR-0006).
 *
 * `pnpm verify` runs every required non-deployment check. CI invokes these SAME
 * scripts, so a green local run means what it says.
 *
 * Every gate runs even after one fails, so a contributor sees the whole picture in
 * one pass rather than peeling them off one at a time.
 */
import { spawnSync } from 'node:child_process';
import { EXIT_BLOCKED_ON_OWNER } from './license-exceptions.mjs';

const GATES = [
  ['format:check', ['format:check']],
  ['lint', ['lint']],
  ['typecheck', ['typecheck']],
  ['test', ['test']],
  ['test:integration', ['test:integration']],
  ['build', ['build']],
  ['test:architecture', ['test:architecture']],
  ['test:licenses', ['test:licenses']],
  ['test:deps', ['test:deps']],
  ['test:secrets', ['test:secrets']],
  ['test:migrations', ['test:migrations']],
  ['test:guardrails', ['test:guardrails']],
  ['spec:validate', ['spec:validate']],
  ['sbom:generate', ['sbom:generate']],
  ['test:e2e', ['test:e2e']],
  ['test:a11y', ['test:a11y']],
  ['test:visual', ['test:visual']],
];

const only = process.argv.slice(2);
const selected = only.length > 0 ? GATES.filter(([name]) => only.includes(name)) : GATES;

if (selected.length === 0) {
  console.error(`verify: no gate matched ${only.join(', ')}`);
  console.error(`Known gates: ${GATES.map(([name]) => name).join(', ')}`);
  process.exit(1);
}

const results = [];
const started = Date.now();

for (const [name, args] of selected) {
  console.log(`\n=== ${name} ===`);
  const at = Date.now();
  const result = spawnSync('pnpm', args, { stdio: 'inherit', shell: false });
  if (result.error) {
    console.error(`${name}: could not run - ${result.error.message}`);
  }
  const code = result.status ?? 1;
  // Exit 3 from the licence gate means everything complies but an exception has no
  // named approver. That is a human decision, not a broken build, and conflating the
  // two would hide which one you are looking at.
  const blocked = name === 'test:licenses' && code === EXIT_BLOCKED_ON_OWNER;
  results.push({ name, code, blocked, ms: Date.now() - at });
}

const blocked = results.filter((result) => result.blocked);
const failed = results.filter((result) => result.code !== 0 && !result.blocked);
const passed = results.filter((result) => result.code === 0);

console.log('\n=== verify summary ===');
for (const { name, code, blocked: isBlocked, ms } of results) {
  const label = code === 0 ? 'PASS' : isBlocked ? 'BLOCK' : 'FAIL';
  console.log(`  ${label.padEnd(5)} ${name.padEnd(20)} ${(ms / 1000).toFixed(1)}s`);
}
console.log(
  `\n  ${passed.length}/${results.length} gates passed, ${failed.length} failed, ` +
    `${blocked.length} blocked, in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

if (failed.length > 0) {
  console.log('\n  Do not weaken a gate to make it pass. See ENGINEERING.md.');
  process.exit(1);
}

if (blocked.length > 0) {
  console.log(
    '\n  Every engineering gate passed. This run is blocked only on a human decision:\n' +
      `  ${blocked.map(({ name }) => name).join(', ')} — see the ledger above and\n` +
      '  docs/external-gates.md, G-11. No code change clears it.',
  );
  process.exit(EXIT_BLOCKED_ON_OWNER);
}
