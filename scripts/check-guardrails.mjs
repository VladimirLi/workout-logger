#!/usr/bin/env node
/**
 * Guardrail self-modification gate (D-035, D-036, ADR-0006).
 *
 * An implementing agent may not change the gates that judge its implementation in
 * the same change. This compares the current branch against the merge base and
 * fails if one change touches BOTH guardrail files and product code.
 *
 * Legitimate guardrail changes are still possible - they are submitted as their own
 * change, reviewed under the existing gates.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(HERE, 'guardrails.json'), 'utf8'));
const productPatterns = config.productPathPatterns.map((source) => new RegExp(source));
/**
 * Files a build tool writes. They are neither a guardrail nor product code, so a
 * regenerated one must not make an otherwise-legitimate guardrail change look like a
 * co-change.
 */
const generatedPaths = new Set(config.generatedPaths ?? []);

const BASE_REF = process.env.GUARDRAIL_BASE_REF ?? 'origin/main';

function git(args) {
  // stderr is suppressed because a missing ref is an expected, handled condition
  // here, not something the operator needs to see as a fatal error.
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function changedFiles() {
  let base;
  try {
    base = git(['merge-base', 'HEAD', BASE_REF]);
  } catch {
    return { files: null, reason: `no merge base with ${BASE_REF}` };
  }
  const output = git(['diff', '--name-only', `${base}...HEAD`]);
  return { files: output ? output.split('\n') : [] };
}

const { files, reason } = changedFiles();

if (files === null) {
  // On a repository with no remote and no branch to compare against, there is
  // nothing to check. Say so explicitly rather than reporting a pass.
  console.log(
    `check-guardrails: not applicable — ${reason}.\n` +
      '  This gate compares a branch against its merge base. It becomes effective once a\n' +
      '  remote exists and changes arrive as pull requests (docs/external-gates.md, G-1).',
  );
  process.exit(0);
}

if (files.length === 0) {
  console.log('check-guardrails: OK — no files changed against the merge base.');
  process.exit(0);
}

const isGuardrail = (file) =>
  config.guardrailPaths.some((path) =>
    path.endsWith('/') ? file.startsWith(path) : file === path,
  );

const touchedGuardrails = files.filter(isGuardrail);
const touchedProduct = files.filter(
  (file) =>
    !isGuardrail(file) &&
    !generatedPaths.has(file) &&
    productPatterns.some((pattern) => pattern.test(file)),
);

if (touchedGuardrails.length > 0 && touchedProduct.length > 0) {
  console.error('check-guardrails: FAILED — this change modifies guardrails AND product code.');
  console.error('\nGuardrail files changed:');
  for (const file of touchedGuardrails) console.error(`  ${file}`);
  console.error('\nProduct files changed:');
  for (const file of touchedProduct.slice(0, 20)) console.error(`  ${file}`);
  console.error(
    '\nSplit these into two changes (D-035/D-036). The guardrail change is reviewed\n' +
      'independently, under the gates as they stand today.',
  );
  process.exit(1);
}

console.log(
  `check-guardrails: OK — ${files.length} files changed; ` +
    `${touchedGuardrails.length} guardrail, ${touchedProduct.length} product (not both).`,
);
process.exit(0);
