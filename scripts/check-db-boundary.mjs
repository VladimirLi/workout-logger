#!/usr/bin/env node
/**
 * The deployed boundary, read back from the database (ADR-0012, I-2 and I-4).
 *
 * A migration that is written correctly and a database that is configured correctly are
 * different claims, and two review cycles turned on the gap between them: the SQL said
 * deny-by-default while `authenticated` still held `TRIGGER` and `MAINTAIN` on every table,
 * because `REVOKE` had named privileges one at a time. Nothing in the repository could see that,
 * because privileges are not visible through PostgREST - only their consequences are.
 *
 * So this reads the schema the project actually has, with `supabase db dump`, and asserts:
 *
 *   I-2  every exposed table grants `authenticated` exactly SELECT, and `anon` nothing at all.
 *   I-4  every boundary function is owned by `postgres`, is SECURITY DEFINER, pins its
 *        `search_path`, and is executable by `authenticated` and nobody else - while the
 *        validation helpers are executable by no client role at all.
 *
 * NOT part of `pnpm verify`: it needs the CLI, a network and a linked project, and the aggregate
 * gate stays hermetic. Run it deliberately:
 *
 *   node scripts/check-db-boundary.mjs
 *
 * It fails rather than skips when the project is not linked, because "no connection, so no
 * finding" is the vacuous pass this check exists to prevent.
 *
 * `--dump <file>` reads a dump that already exists instead of taking one, which is how the
 * checks themselves are tested (scripts/check-db-boundary.test.ts). A check nobody has watched
 * fail is a check nobody can trust.
 *
 * GUARDRAIL FILE. It prints table names, function names and privilege names only. The dump goes
 * to a temporary file and its contents are never printed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The tables a client may read, and nothing else (ADR-0012, I-2). */
const TABLES = [
  'plans',
  'workout_sessions',
  'recorded_sets',
  'session_corrections',
  'proposals',
  'idempotency_records',
];

/** The functions a client calls. Everything a write needs goes through one of these. */
const BOUNDARY_FUNCTIONS = [
  'accept_proposal',
  'reject_proposal',
  'mark_proposal_stale_if_pending',
  'apply_workout_mutation',
];

/** Called inside the functions above, which run as their owner, so no client role needs them. */
const HELPER_FUNCTIONS = [
  'is_valid_measurement',
  'json_is_positive_integer',
  'json_is_nonnegative_number',
  'json_is_nonempty_string',
  'json_is_quantity',
  'json_timestamptz',
];

/** Functions that must no longer exist, because a later migration replaced them. */
const WITHDRAWN_FUNCTIONS = ['decide_proposal'];

const PERMITTED_TABLE_PRIVILEGES = { authenticated: ['SELECT'], anon: [] };

const problems = [];

/** `supabase db dump`, into a directory that is removed afterwards. */
function dumpSchema() {
  const directory = mkdtempSync(join(tmpdir(), 'db-boundary-'));
  const file = join(directory, 'schema.sql');
  const result = spawnSync(
    'supabase',
    ['db', 'dump', '--linked', '--schema', 'public', '-f', file],
    { encoding: 'utf8', timeout: 300_000 },
  );
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    const reason = (result.stderr ?? '').split('\n').slice(-5).join(' ').trim();
    throw new Error(
      `could not dump the linked project's schema: ${reason || `exit ${String(result.status)}`}.\n` +
        '  The project must be linked (`supabase link`) and the CLI authenticated.',
    );
  }
  try {
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Identifiers in a dump are quoted; this strips the quoting for comparison. */
const plain = (text) => text.replace(/"/g, '').trim();

/**
 * Privilege statements, outside function bodies.
 *
 * A body is delimited by `$$`, and can contain anything, so lines inside one are skipped rather
 * than parsed. Returns one entry per statement, with the object it names.
 */
function privilegeStatements(dump) {
  const statements = [];
  let insideBody = false;
  for (const line of dump.split('\n')) {
    const delimiters = (line.match(/\$\$/g) ?? []).length;
    if (insideBody) {
      if (delimiters % 2 === 1) insideBody = false;
      continue;
    }
    if (delimiters % 2 === 1) {
      insideBody = true;
      continue;
    }
    const match =
      /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(FUNCTION|TABLE|SCHEMA|SEQUENCE)\s+(.+?)\s+(?:TO|FROM)\s+(.+);$/.exec(
        line.trim(),
      );
    if (!match) continue;
    const [, action, privileges, objectKind, object, role] = match;
    statements.push({
      action,
      privileges: privileges
        .toUpperCase()
        .split(',')
        .map((privilege) => privilege.trim()),
      objectKind,
      /** `public.name` for a table; `public.name` without the argument list for a function. */
      object: plain(object.replace(/\(.*$/, '')),
      role: plain(role).toLowerCase(),
    });
  }
  return statements;
}

/** Each function's header, which is where ownership and `search_path` are stated. */
function functionFacts(dump) {
  const facts = new Map();
  const lines = dump.split('\n');
  let current;
  for (const [index, line] of lines.entries()) {
    const created = /^CREATE (?:OR REPLACE )?FUNCTION "public"\."([a-z_]+)"/.exec(line);
    if (created) {
      current = created[1];
      const header = lines.slice(index, index + 6).join('\n');
      facts.set(current, {
        securityDefiner: /SECURITY DEFINER/.test(header),
        searchPath: /SET "search_path" TO ([^\n]+)/.exec(header)?.[1]?.trim(),
        owner: undefined,
      });
      continue;
    }
    const owned = /^ALTER FUNCTION "public"\."([a-z_]+)".*OWNER TO "([a-z_]+)";/.exec(line);
    if (owned) {
      const fact = facts.get(owned[1]);
      if (fact) fact.owner = owned[2];
    }
  }
  return facts;
}

const given = process.argv.indexOf('--dump');
const dump = given === -1 ? dumpSchema() : readFileSync(process.argv[given + 1], 'utf8');
const statements = privilegeStatements(dump);
const functions = functionFacts(dump);

// I-2: what a client role holds on each table, as deployed.
for (const table of TABLES) {
  const object = `public.${table}`;
  if (!dump.includes(`CREATE TABLE IF NOT EXISTS "public"."${table}"`)) {
    problems.push(`${object} is not in the deployed schema`);
    continue;
  }
  for (const [role, permitted] of Object.entries(PERMITTED_TABLE_PRIVILEGES)) {
    const held = new Set();
    for (const statement of statements) {
      if (statement.objectKind !== 'TABLE' || statement.object !== object) continue;
      if (statement.role !== role) continue;
      for (const privilege of statement.privileges) {
        if (statement.action === 'GRANT') held.add(privilege);
        else held.delete(privilege);
      }
    }
    const leftover = [...held].filter((privilege) => !permitted.includes(privilege)).sort();
    if (leftover.length > 0) {
      problems.push(
        `${object} grants ${role} ${leftover.join(', ')}, and every write belongs to a ` +
          'function (ADR-0012, I-2)',
      );
    }
    for (const privilege of permitted) {
      if (!held.has(privilege)) {
        problems.push(`${object} does not grant ${role} ${privilege}, so the app cannot read it`);
      }
    }
  }
}

// I-4: the functions that hold the authority.
for (const name of BOUNDARY_FUNCTIONS) {
  const fact = functions.get(name);
  if (!fact) {
    problems.push(`public.${name} is not in the deployed schema`);
    continue;
  }
  if (fact.owner !== 'postgres') {
    problems.push(
      `public.${name} is owned by ${fact.owner ?? 'nobody the dump states'}, so it runs as that ` +
        'role instead of postgres (ADR-0012, I-4)',
    );
  }
  if (!fact.securityDefiner) {
    problems.push(`public.${name} is not SECURITY DEFINER, so it cannot own the writes`);
  }
  if (!fact.searchPath?.startsWith("'pg_catalog'")) {
    problems.push(
      `public.${name} does not pin search_path to pg_catalog first (found ` +
        `${fact.searchPath ?? 'nothing'}), so a shadowing object could be resolved instead`,
    );
  }

  const executors = new Set();
  for (const statement of statements) {
    if (statement.objectKind !== 'FUNCTION' || statement.object !== `public.${name}`) continue;
    if (statement.action === 'GRANT') executors.add(statement.role);
    else executors.delete(statement.role);
  }
  if (!executors.has('authenticated')) {
    problems.push(`public.${name} is not executable by authenticated, so the app cannot call it`);
  }
  for (const role of executors) {
    if (!['authenticated', 'service_role', 'postgres'].includes(role)) {
      problems.push(`public.${name} is executable by ${role} (ADR-0012, I-4)`);
    }
  }
}

for (const name of HELPER_FUNCTIONS) {
  if (!functions.has(name)) {
    problems.push(`public.${name} is not in the deployed schema`);
    continue;
  }
  for (const statement of statements) {
    if (statement.objectKind !== 'FUNCTION' || statement.object !== `public.${name}`) continue;
    if (statement.action !== 'GRANT') continue;
    if (['anon', 'authenticated'].includes(statement.role)) {
      problems.push(
        `public.${name} is executable by ${statement.role}, and a validation helper is surface ` +
          'with no purpose outside the functions that call it (ADR-0012, I-4)',
      );
    }
  }
}

for (const name of WITHDRAWN_FUNCTIONS) {
  if (functions.has(name)) {
    problems.push(`public.${name} was replaced and is still deployed`);
  }
}

if (problems.length === 0) {
  console.log(
    `check-db-boundary: OK — ${String(TABLES.length)} tables grant authenticated SELECT only, ` +
      `${String(BOUNDARY_FUNCTIONS.length)} boundary functions are owned by postgres with a ` +
      `pinned search_path, and ${String(HELPER_FUNCTIONS.length)} helpers are callable by no ` +
      'client role.',
  );
  process.exit(0);
}

console.error(`check-db-boundary: FAILED — ${String(problems.length)} problems:`);
for (const problem of problems) console.error(`  ${problem}`);
console.error('\nSee docs/adr/0012-one-trusted-write-boundary.md.');
process.exit(1);
