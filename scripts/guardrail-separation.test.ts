import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
 */

const AUDIT_TIMEOUT_MS = 60_000;
const SCRIPT = resolve('scripts/check-guardrails.mjs');

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
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
      const output = execFileSync('node', ['scripts/check-guardrails.mjs', '--range', 'HEAD'], {
        encoding: 'utf8',
      });
      expect(output).toContain('guardrail-only, product-only, or neither');
    },
    AUDIT_TIMEOUT_MS,
  );

  it(
    'fails a commit that changes both, rather than passing everything',
    () => {
      // The audit is only worth anything if it can fail. A throwaway repository gets one
      // commit touching a guardrail file and a product file, and the real script - reading
      // the real guardrails.json - must reject it. This repository is not touched.
      const sandbox = mkdtempSync(join(tmpdir(), 'guardrail-separation-'));
      try {
        const run = (args: string[]) =>
          execFileSync('git', args, { cwd: sandbox, encoding: 'utf8', stdio: 'pipe' });
        run(['init', '--quiet', '--initial-branch=main']);
        run(['config', 'user.email', 'probe@example.invalid']);
        run(['config', 'user.name', 'Probe']);
        writeFileSync(join(sandbox, 'README.md'), '# probe\n');
        run(['add', '.']);
        run(['commit', '--quiet', '-m', 'docs: base commit']);

        mkdirSync(join(sandbox, 'apps/web/ui/primitives'), { recursive: true });
        writeFileSync(join(sandbox, 'playwright.config.ts'), 'export default {};\n');
        writeFileSync(join(sandbox, 'apps/web/ui/primitives/Probe.tsx'), 'export const P = 1;\n');
        run(['add', '.']);
        run(['commit', '--quiet', '-m', 'feat: widen a gate while changing the code it judges']);

        const audit = spawnSync('node', [SCRIPT, '--range', 'HEAD'], {
          cwd: sandbox,
          encoding: 'utf8',
        });
        expect(audit.status).toBe(1);
        expect(audit.stderr).toContain('modify guardrails AND product code');
        expect(audit.stderr).toContain('guardrail: playwright.config.ts');
        expect(audit.stderr).toContain('product:   apps/web/ui/primitives/Probe.tsx');
      } finally {
        rmSync(sandbox, { recursive: true, force: true });
      }
    },
    AUDIT_TIMEOUT_MS,
  );
});
