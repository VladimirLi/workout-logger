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
 *
 * `--range <rev-range>` classifies each commit in the range separately instead. Before a
 * remote exists there is no merge base and no pull request, so the branch comparison above
 * reports "not applicable" and the separation is carried by the commits themselves: each one
 * is guardrail-only, product-only, or neither. Merge commits are audited by their combined
 * diff, which is the resolution the merge itself introduced. That is what a reviewer reads, and
 * scripts/guardrail-separation.test.ts holds it for every commit in the history.
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

/**
 * Guardrail files that cannot be named as a literal path. The package manifests are the
 * case: the root one defines every gate command, and a workspace one defines the build that
 * the build gate delegates to, so editing a manifest can make a gate pass by doing nothing.
 */
const guardrailPatterns = (config.guardrailPathPatterns ?? []).map((source) => new RegExp(source));

const isGuardrail = (file) =>
  config.guardrailPaths.some((path) =>
    path.endsWith('/') ? file.startsWith(path) : file === path,
  ) || guardrailPatterns.some((pattern) => pattern.test(file));

/** Splits a file list into the two categories the rule is about. Anything else is neither. */
function classify(files) {
  const guardrails = files.filter(isGuardrail);
  const product = files.filter(
    (file) =>
      !isGuardrail(file) &&
      !generatedPaths.has(file) &&
      productPatterns.some((pattern) => pattern.test(file)),
  );
  return { guardrails, product, mixed: guardrails.length > 0 && product.length > 0 };
}

const SPLIT_ADVICE =
  'Split these into two changes (D-035/D-036). The guardrail change is reviewed\n' +
  'independently, under the gates as they stand today.';

const rangeIndex = process.argv.indexOf('--range');
if (rangeIndex !== -1) {
  const range = process.argv[rangeIndex + 1];
  if (!range) {
    console.error('check-guardrails: --range needs a git rev-range, for example A..HEAD.');
    process.exit(2);
  }
  const listed = git(['rev-list', '--reverse', range]);
  const commits = listed ? listed.split('\n') : [];
  const mixed = [];
  for (const commit of commits) {
    // --cc is what makes a merge commit auditable rather than skipped. A combined diff lists
    // only the files that differ from EVERY parent, which is exactly the merge's own work: an
    // evil merge that widens a gate while editing the code that gate judges shows up here,
    // and a clean merge lists nothing because each side's changes belong to the parent commits
    // that carry them - and those are in this range too. On a non-merge commit --cc is the
    // ordinary diff. It is passed explicitly because `git show` chooses a merge format from
    // configuration, and this classification must not depend on the operator's git config.
    const output = git(['show', '--name-only', '--format=', '--cc', commit]);
    const result = classify(output ? output.split('\n').filter(Boolean) : []);
    if (result.mixed) mixed.push({ commit, ...result });
  }
  if (mixed.length > 0) {
    console.error(
      `check-guardrails: FAILED — ${mixed.length} of ${commits.length} commits in ${range} ` +
        'modify guardrails AND product code.',
    );
    for (const entry of mixed) {
      const subject = git(['log', '-1', '--format=%s', entry.commit]);
      console.error(`\n  ${entry.commit.slice(0, 7)} ${subject}`);
      for (const file of entry.guardrails.slice(0, 10)) console.error(`    guardrail: ${file}`);
      for (const file of entry.product.slice(0, 10)) console.error(`    product:   ${file}`);
    }
    console.error(`\n${SPLIT_ADVICE}`);
    process.exit(1);
  }
  console.log(
    `check-guardrails: OK — each of ${commits.length} commits in ${range} is guardrail-only, ` +
      'product-only, or neither.',
  );
  process.exit(0);
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

const { guardrails: touchedGuardrails, product: touchedProduct, mixed } = classify(files);

if (mixed) {
  console.error('check-guardrails: FAILED — this change modifies guardrails AND product code.');
  console.error('\nGuardrail files changed:');
  for (const file of touchedGuardrails) console.error(`  ${file}`);
  console.error('\nProduct files changed:');
  for (const file of touchedProduct.slice(0, 20)) console.error(`  ${file}`);
  console.error(`\n${SPLIT_ADVICE}`);
  process.exit(1);
}

console.log(
  `check-guardrails: OK — ${files.length} files changed; ` +
    `${touchedGuardrails.length} guardrail, ${touchedProduct.length} product (not both).`,
);
process.exit(0);
