import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The migration gate's authorization checks (identity spec, tasks 2.2 and 2.4).
 *
 * A table reachable through the exposed schema without row-level security is the single
 * mistake that turns a per-user product into a shared one, and it is invisible until someone
 * looks. These run the real gate against throwaway migrations, because a static check nobody
 * has watched fail is a static check nobody can trust.
 *
 * Running deny-by-default queries as two identities is task 2.3 and needs a database (G-2).
 */

const GATE = resolve('scripts/validate-migrations.mjs');
const PREAMBLE = "SET LOCAL lock_timeout = '5s';\nSET LOCAL statement_timeout = '60s';\n";

/** A minimally correct table: secured, forced, granted, revoked, policy on an indexed column. */
const CORRECT = `${PREAMBLE}
CREATE TABLE IF NOT EXISTS public.things (
  user_id uuid NOT NULL,
  id text NOT NULL,
  PRIMARY KEY (user_id, id)
);
ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.things FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.things TO authenticated;
CREATE POLICY things_owner ON public.things
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()));
`;

function runAll(migrations: Record<string, string>): {
  status: number;
  stderr: string;
  stdout: string;
} {
  const directory = mkdtempSync(join(tmpdir(), 'migration-gate-'));
  try {
    mkdirSync(join(directory, 'supabase', 'migrations'), { recursive: true });
    for (const [name, sql] of Object.entries(migrations)) {
      writeFileSync(join(directory, 'supabase', 'migrations', name), sql);
    }
    const result = spawnSync('node', [GATE], { cwd: directory, encoding: 'utf8' });
    return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(sql: string): { status: number; stderr: string; stdout: string } {
  return runAll({ '20260101000000_probe.sql': sql });
}

describe('the migration gate', () => {
  it('accepts a table that is secured, granted, revoked, and has an indexed policy', () => {
    const result = run(CORRECT);
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects a reachable table with no row-level security', () => {
    const result = run(CORRECT.replace('ALTER TABLE public.things ENABLE ROW LEVEL SECURITY;', ''));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not ENABLE ROW LEVEL SECURITY');
  });

  it('rejects a table with no explicit grant', () => {
    const result = run(CORRECT.replace('GRANT SELECT ON public.things TO authenticated;', ''));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has no explicit GRANT');
  });

  it('rejects a table that does not revoke from anon', () => {
    const result = run(
      CORRECT.replace('REVOKE ALL ON public.things FROM PUBLIC, anon, authenticated;', ''),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('deny by default');
  });

  it('rejects a table left writable by every signed-in user', () => {
    // Supabase's default privileges grant ALL on a new table in `public` to `authenticated`, so
    // revoking from PUBLIC and anon leaves a signed-in user able to write it directly - past
    // the functions that own those writes. The gate missed this until a caller proved it
    // (review of d535b3f..cc91a55).
    const result = run(CORRECT.replace('FROM PUBLIC, anon, authenticated;', 'FROM PUBLIC, anon;'));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is never revoked from authenticated');
  });

  it('accepts the revocation arriving in a later migration, since an applied one is not rewritten', () => {
    const result = runAll({
      '20260101000000_probe.sql': CORRECT.replace(
        'FROM PUBLIC, anon, authenticated;',
        'FROM PUBLIC, anon;',
      ),
      '20260102000000_lock_writes.sql': `${PREAMBLE}REVOKE INSERT, UPDATE, DELETE ON public.things FROM authenticated;\n`,
    });
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects a secured table with no policy, which would be unreadable', () => {
    const result = run(CORRECT.slice(0, CORRECT.indexOf('CREATE POLICY')));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('has row-level security and no policy');
  });

  it('rejects a policy comparing a column that no index leads with', () => {
    // `id` is the SECOND column of the key, so the key does not serve a predicate on it.
    const result = run(
      CORRECT.replace('USING (user_id = (SELECT auth.uid()))', 'USING (id = (SELECT auth.uid()))'),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is compared by a policy and is not the leading column');
  });

  it('accepts a policy column covered by a standalone index rather than the key', () => {
    const sql = CORRECT.replace(
      'CREATE POLICY',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS things_owner_id ON public.things (owner_id);\nCREATE POLICY',
    )
      .replace('  id text NOT NULL,', '  id text NOT NULL,\n  owner_id uuid NOT NULL,')
      .replace('USING (user_id = (SELECT auth.uid()))', 'USING (owner_id = (SELECT auth.uid()))');
    const result = run(sql);
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('still enforces the expand-contract rules it enforced before', () => {
    const withoutTimeouts = CORRECT.replace(PREAMBLE, '');
    const result = run(withoutTimeouts);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('lock_timeout');
  });

  it('reports the repository migrations as satisfying every rule', () => {
    // The real ones, in the real directory: the checks above are only worth having if the
    // schema this project actually ships passes them.
    const result = spawnSync('node', [GATE], { encoding: 'utf8' });
    expect(result.stderr, result.stderr).toBe('');
    expect(result.stdout).toContain('satisfy the expand-contract rules');
  });
});
