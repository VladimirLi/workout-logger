import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Per-commit guardrail separation over the whole history (D-035, D-036, ADR-0006).
 *
 * `check-guardrails.mjs` compares a branch against its merge base, which is the right unit
 * once changes arrive as pull requests. There is no remote yet (gate G-1), so that comparison
 * reports "not applicable" and nothing holds the rule in the meantime. A reviewer reading a
 * range of commits then has to classify them by hand, and a reviewer who diffs the whole range
 * as one change sees guardrail and product files together and reports a violation that no
 * commit actually made.
 *
 * This closes that gap: every commit in the history must be guardrail-only, product-only, or
 * neither. It is the same classification the gate uses, from the same guardrails.json, applied
 * one commit at a time. It only ever becomes stricter than the branch check - a range that
 * passes here can still fail the merge-base check, and must.
 *
 * A shallow clone would make this pass while checking almost nothing, so the history is
 * required to be complete. CI checks out with fetch-depth: 0 for exactly this reason.
 *
 * The mutation tests below are the point of the file: an audit that cannot be shown to fail is
 * indistinguishable from one that passes everything. Each builds a throwaway repository, and
 * the real script reading the real guardrails.json must reject it.
 */

const AUDIT_TIMEOUT_MS = 60_000;
const SCRIPT = resolve('scripts/check-guardrails.mjs');

const GUARDRAIL_FILE = 'playwright.config.ts';
const PRODUCT_FILE = 'apps/web/ui/primitives/Probe.tsx';

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

/** A throwaway repository with one base commit, and the helpers to build history in it. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'guardrail-separation-'));
  const run = (args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim();
  const write = (path: string, body: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  const commit = (message: string) => {
    run(['add', '--all']);
    run(['commit', '--quiet', '-m', message]);
  };
  /** Runs the real audit over the sandbox history. */
  const audit = () =>
    spawnSync('node', [SCRIPT, '--range', 'HEAD'], { cwd: dir, encoding: 'utf8' });

  run(['init', '--quiet', '--initial-branch=main']);
  run(['config', 'user.email', 'probe@example.invalid']);
  run(['config', 'user.name', 'Probe']);
  // The base history is built in separated commits, so a later failure is attributable to
  // what the test did and not to the fixture. Creating both files in one commit would make
  // every mutation test below pass for the wrong reason.
  write('README.md', '# probe\n');
  commit('docs: base commit');
  write(GUARDRAIL_FILE, 'export default {};\n');
  commit('build(guardrail): add the gate config');
  write(PRODUCT_FILE, 'export const probe = 1;\n');
  commit('feat: add the product file');
  const clean = audit();
  if (clean.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`sandbox base history is not separated:\n${clean.stderr}`);
  }

  return {
    dir,
    run,
    write,
    commit,
    audit,
    /** Commits reachable from HEAD, so a test can assert nothing was filtered out. */
    count: () => Number(run(['rev-list', '--count', 'HEAD'])),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('guardrail separation, commit by commit', () => {
  it('has the complete history to audit, not a shallow clone', () => {
    expect(git(['rev-parse', '--is-shallow-repository'])).toBe('false');
    // One root commit, reachable from HEAD: the audit below covers everything back to it.
    expect(git(['rev-list', '--max-parents=0', 'HEAD']).split('\n')).toHaveLength(1);
  });

  it(
    'has no commit that changes guardrails and product code together',
    () => {
      // --range exits non-zero and names every offending commit, so a failure here is a
      // readable list rather than a boolean.
      const output = execFileSync('node', [SCRIPT, '--range', 'HEAD'], { encoding: 'utf8' });
      expect(output).toContain('guardrail-only, product-only, or neither');
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'audits every commit in the history, merges included',
    () => {
      // A skipped commit is an unaudited commit. The count the script reports must be the
      // number of commits reachable from HEAD, with nothing filtered out.
      const output = execFileSync('node', [SCRIPT, '--range', 'HEAD'], { encoding: 'utf8' });
      const reachable = git(['rev-list', '--count', 'HEAD']);
      expect(output).toContain(`each of ${reachable} commits`);
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'fails a commit that changes both, rather than passing everything',
    () => {
      const repo = sandbox();
      try {
        repo.write(GUARDRAIL_FILE, 'export default { retries: 5 };\n');
        repo.write(PRODUCT_FILE, 'export const probe = 2;\n');
        repo.commit('feat: widen a gate while changing the code it judges');

        const audit = repo.audit();
        expect(audit.status).toBe(1);
        expect(audit.stderr).toContain('modify guardrails AND product code');
        expect(audit.stderr).toContain(`guardrail: ${GUARDRAIL_FILE}`);
        expect(audit.stderr).toContain(`product:   ${PRODUCT_FILE}`);
      } finally {
        repo.dispose();
      }
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'fails an evil merge whose resolution changes both',
    () => {
      // Linear history is not enforced by anything outside this repository, so a merge is a
      // place a co-change could hide. The merge's own work is its combined diff: what differs
      // from every parent. Here the resolution edits a guardrail and a product file that
      // neither side touched that way, which is exactly a co-change wearing a merge's clothes.
      const repo = sandbox();
      try {
        repo.run(['checkout', '--quiet', '-b', 'feature']);
        repo.write(PRODUCT_FILE, 'export const probe = 2;\n');
        repo.commit('feat: change the product on a branch');

        repo.run(['checkout', '--quiet', 'main']);
        repo.write(GUARDRAIL_FILE, 'export default { retries: 1 };\n');
        repo.commit('build(guardrail): change a gate on main');

        repo.run(['merge', '--quiet', '--no-ff', '--no-commit', 'feature']);
        repo.write(GUARDRAIL_FILE, 'export default { retries: 5 };\n');
        repo.write(PRODUCT_FILE, 'export const probe = 3;\n');
        repo.commit('merge: resolve by editing both');

        const audit = repo.audit();
        expect(audit.status).toBe(1);
        expect(audit.stderr).toContain('resolve by editing both');
        expect(audit.stderr).toContain(`guardrail: ${GUARDRAIL_FILE}`);
        expect(audit.stderr).toContain(`product:   ${PRODUCT_FILE}`);
      } finally {
        repo.dispose();
      }
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'passes a merge that only brings together two separated commits',
    () => {
      // The complement of the test above, and the reason merges are read by combined diff
      // rather than rejected outright: a merge of a guardrail-only commit and a product-only
      // commit introduces no co-change. Failing it would make the rule unusable on any
      // non-linear history and invite someone to loosen the audit instead.
      const repo = sandbox();
      try {
        repo.run(['checkout', '--quiet', '-b', 'feature']);
        repo.write(PRODUCT_FILE, 'export const probe = 2;\n');
        repo.commit('feat: change the product on a branch');

        repo.run(['checkout', '--quiet', 'main']);
        repo.write(GUARDRAIL_FILE, 'export default { retries: 1 };\n');
        repo.commit('build(guardrail): change a gate on main');
        repo.run(['merge', '--quiet', '--no-ff', '-m', 'merge: bring the branch in', 'feature']);

        const audit = repo.audit();
        expect(audit.stderr).toBe('');
        expect(audit.status).toBe(0);
        // The merge and both sides were read, not skipped.
        expect(audit.stdout).toContain(`each of ${repo.count()} commits`);
        expect(repo.count()).toBe(6);
      } finally {
        repo.dispose();
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});
