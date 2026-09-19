import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The checks in check-db-boundary.mjs, against dumps that state each mistake (ADR-0012).
 *
 * The live check reads the deployed schema, so by itself it only ever says "OK" until something
 * is wrong on the project - and a check nobody has watched fail is a check nobody can trust.
 * These feed it a dump it cannot object to, then break one thing at a time.
 *
 * The dump is a fixture written here rather than a captured one: a real dump is large, carries
 * project detail, and would have to be refreshed to stay comparable.
 */

const CHECK = resolve('scripts/check-db-boundary.mjs');

const TABLES = [
  'plans',
  'workout_sessions',
  'recorded_sets',
  'session_corrections',
  'proposals',
  'idempotency_records',
];

const BOUNDARY = [
  ['accept_proposal', '"p_proposal_id" "text", "p_expected_status" "text"'],
  ['reject_proposal', '"p_proposal_id" "text", "p_expected_status" "text"'],
  ['mark_proposal_stale_if_pending', '"p_proposal_id" "text"'],
  ['apply_workout_mutation', '"p_key" "uuid", "p_mutation" "jsonb"'],
] as const;

const HELPERS = [
  'is_valid_measurement',
  'json_is_positive_integer',
  'json_is_nonnegative_number',
  'json_is_nonempty_string',
  'json_is_quantity',
  'json_timestamptz',
];

/** A dump of a project configured exactly as ADR-0012 requires. */
function aCorrectDump(): string {
  const parts: string[] = [];
  for (const table of TABLES) {
    parts.push(
      `CREATE TABLE IF NOT EXISTS "public"."${table}" (\n    "user_id" "uuid" NOT NULL\n);`,
    );
    parts.push(`ALTER TABLE "public"."${table}" OWNER TO "postgres";`);
  }
  for (const [name, args] of [...BOUNDARY, ...HELPERS.map((helper) => [helper, '"p" "jsonb"'])]) {
    parts.push(
      `CREATE OR REPLACE FUNCTION "public"."${name}"(${args}) RETURNS "jsonb"\n` +
        '    LANGUAGE "plpgsql" SECURITY DEFINER\n' +
        `    SET "search_path" TO 'pg_catalog', 'public'\n` +
        '    AS $$\nBEGIN\n  -- a body, with a ; and a GRANT ALL ON TABLE "public"."plans" TO "anon";\n' +
        '  RETURN NULL;\nEND;\n$$;',
    );
    parts.push(`ALTER FUNCTION "public"."${name}"(${args}) OWNER TO "postgres";`);
  }
  for (const table of TABLES) {
    parts.push(`GRANT SELECT ON TABLE "public"."${table}" TO "authenticated";`);
    parts.push(`GRANT ALL ON TABLE "public"."${table}" TO "service_role";`);
  }
  for (const [name, args] of BOUNDARY) {
    parts.push(`REVOKE ALL ON FUNCTION "public"."${name}"(${args}) FROM PUBLIC;`);
    parts.push(`GRANT ALL ON FUNCTION "public"."${name}"(${args}) TO "authenticated";`);
    parts.push(`GRANT ALL ON FUNCTION "public"."${name}"(${args}) TO "service_role";`);
  }
  return `${parts.join('\n\n')}\n`;
}

function run(dump: string): { status: number; stderr: string; stdout: string } {
  const directory = mkdtempSync(join(tmpdir(), 'boundary-check-'));
  try {
    const file = join(directory, 'schema.sql');
    writeFileSync(file, dump);
    const result = spawnSync('node', [CHECK, '--dump', file], { encoding: 'utf8' });
    return { status: result.status ?? -1, stderr: result.stderr, stdout: result.stdout };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('the deployed-boundary check', () => {
  it('accepts a project configured as the trust model requires', () => {
    const result = run(aCorrectDump());
    expect(result.stderr, result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects a privilege the default grants left behind', () => {
    // What the project was actually carrying: `REVOKE` named privileges one at a time, so
    // TRIGGER and MAINTAIN stayed. TRIGGER on a readable table is enough to attach a function.
    const result = run(
      aCorrectDump().replace(
        'GRANT SELECT ON TABLE "public"."plans" TO "authenticated";',
        'GRANT SELECT,TRIGGER,MAINTAIN ON TABLE "public"."plans" TO "authenticated";',
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('grants authenticated MAINTAIN, TRIGGER');
  });

  it('rejects any table privilege for the anonymous role', () => {
    const result = run(`${aCorrectDump()}GRANT SELECT ON TABLE "public"."proposals" TO "anon";\n`);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('grants anon SELECT');
  });

  it('rejects a table the app can no longer read', () => {
    const result = run(
      aCorrectDump().replace(
        'GRANT SELECT ON TABLE "public"."recorded_sets" TO "authenticated";',
        '',
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not grant authenticated SELECT');
  });

  it('rejects a boundary function owned by anybody but postgres', () => {
    const result = run(
      aCorrectDump().replace(
        'ALTER FUNCTION "public"."accept_proposal"("p_proposal_id" "text", "p_expected_status" "text") OWNER TO "postgres";',
        'ALTER FUNCTION "public"."accept_proposal"("p_proposal_id" "text", "p_expected_status" "text") OWNER TO "authenticator";',
      ),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/accept_proposal is owned by authenticator/);
  });

  it('rejects a boundary function whose search_path is not pinned', () => {
    const result = run(
      aCorrectDump().replace(`    SET "search_path" TO 'pg_catalog', 'public'\n`, ''),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not pin search_path');
  });

  it('rejects a boundary function that is not SECURITY DEFINER', () => {
    const result = run(
      aCorrectDump().replace('LANGUAGE "plpgsql" SECURITY DEFINER', 'LANGUAGE "plpgsql"'),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not SECURITY DEFINER');
  });

  it('rejects a validation helper a client role can call', () => {
    const result = run(
      `${aCorrectDump()}GRANT ALL ON FUNCTION "public"."is_valid_measurement"("p" "jsonb") TO "authenticated";\n`,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is_valid_measurement is executable by authenticated');
  });

  it('rejects a withdrawn function that is still deployed', () => {
    const result = run(
      `${aCorrectDump()}CREATE OR REPLACE FUNCTION "public"."decide_proposal"("p_proposal_id" "text") RETURNS "jsonb"\n    LANGUAGE "plpgsql"\n    AS $$BEGIN RETURN NULL; END;$$;\n`,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('decide_proposal was replaced and is still deployed');
  });

  it('is the check the repository actually ships', () => {
    // The fixtures above are only worth something if they are fed to the real file.
    expect(readFileSync(CHECK, 'utf8')).toContain('check-db-boundary: OK');
  });
});
