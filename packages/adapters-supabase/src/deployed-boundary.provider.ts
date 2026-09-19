import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * The deployed project, checked as part of the provider run (ADR-0012, I-2 and I-4).
 *
 * The rest of this suite proves what the boundary refuses by asking it to do the wrong thing.
 * Two things cannot be observed that way, because PostgREST exposes their consequences and not
 * their state: the exact privilege set a role holds on a table, and which role a function runs
 * as. `TRIGGER` is the example that matters - it was granted on every table for three days, and
 * no request could have revealed it.
 *
 * So this runs the check that reads the deployed schema. It belongs to the provider run rather
 * than to `pnpm verify` for the same reason as everything else here: it needs the linked project.
 * Its own checks are exercised hermetically against synthetic dumps in
 * scripts/check-db-boundary.test.ts.
 */

describe('the deployed database boundary', () => {
  it('grants only what the trust model permits, and owns its functions', () => {
    const result = spawnSync('node', ['scripts/check-db-boundary.mjs'], {
      encoding: 'utf8',
      timeout: 300_000,
    });

    expect(result.stderr, result.stderr).toBe('');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('check-db-boundary: OK');
  }, 300_000);
});
