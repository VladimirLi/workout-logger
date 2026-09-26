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

const GATES = [
  ['format:check', ['format:check']],
  ['lint', ['lint']],
  ['typecheck', ['typecheck']],
  ['test', ['test']],
  ['test:integration', ['test:integration']],
  ['build', ['build']],
  ['storybook:build', ['storybook:build']],
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
  results.push({ name, code, ms: Date.now() - at });
}

const failed = results.filter((result) => result.code !== 0);
const passed = results.filter((result) => result.code === 0);

console.log('\n=== verify summary ===');
for (const { name, code, ms } of results) {
  const label = code === 0 ? 'PASS' : 'FAIL';
  console.log(`  ${label.padEnd(5)} ${name.padEnd(20)} ${(ms / 1000).toFixed(1)}s`);
}
console.log(
  `\n  ${passed.length}/${results.length} gates passed, ${failed.length} failed, ` +
    `0 blocked, in ${((Date.now() - started) / 1000).toFixed(1)}s`,
);

if (failed.length > 0) {
  console.log('\n  Do not weaken a gate to make it pass. See ENGINEERING.md.');
  process.exit(1);
}
