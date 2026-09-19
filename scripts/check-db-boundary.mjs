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

/**
 * Functions Supabase configures itself, which this repository did not write and does not revoke.
 *
 * `rls_auto_enable` is the event trigger that turns row-level security on for a new table in
 * `public`; ADR-0011 records it. Failing on it would make this check red for something
 * deliberately left alone.
 */
const PLATFORM_FUNCTIONS = ['rls_auto_enable'];

/**
 * Helpers are not listed. Every function in `public` that is not a boundary function is one, and
 * none of them may be executable by a client role.
 *
 * A list was the defect: migration 20260919170000 added five helpers, the list kept naming six
 * older ones, and the five nobody had added were audited by nobody - they could have been granted
 * to `authenticated` and this check would still have said OK. The set now comes from the schema,
 * so a helper a later migration adds is covered on the day it is deployed.
 */
const EXPECTED_HELPERS = [
  'is_valid_measurement',
  'json_is_positive_integer',
  'json_is_nonnegative_number',
  'json_is_nonempty_string',
  'json_is_quantity',
  'json_timestamptz',
  'json_has_only',
  'json_is_notes',
  'json_is_strength_exertion',
  'json_is_cardio_exertion',
  'json_is_incline',
];

/** Functions that must no longer exist, because a later migration replaced them. */
const WITHDRAWN_FUNCTIONS = ['decide_proposal'];

const PERMITTED_TABLE_PRIVILEGES = { authenticated: ['SELECT'], anon: [] };

/** The roles a browser can hold. A grant to PUBLIC reaches both without naming either. */
const CLIENT_ROLES = ['anon', 'authenticated'];

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
      /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(FUNCTION|TABLE|SCHEMA|SEQUENCE|ALL TABLES IN SCHEMA)\s+(.+?)\s+(?:TO|FROM)\s+(.+);$/.exec(
        line.trim(),
      );
    if (!match) {
      // A default privilege grants every table created afterwards, which no per-object check can
      // see. It is reported rather than modelled.
      const defaults =
        /^ALTER DEFAULT PRIVILEGES\b.*\bGRANT\s+(.+?)\s+ON\s+TABLES\s+TO\s+(.+);$/.exec(
          line.trim(),
        );
      if (defaults) {
        statements.push({
          action: 'DEFAULT',
          privileges: defaults[1]
            .toUpperCase()
            .split(',')
            .map((privilege) => privilege.trim()),
          objectKind: 'DEFAULT',
          object: 'public',
          roles: plain(defaults[2])
            .toLowerCase()
            .split(',')
            .map((role) => role.trim()),
        });
      }
      continue;
    }
    const [, action, privileges, objectKind, object, role] = match;
    const named = plain(role).toLowerCase();
    statements.push({
      action,
      privileges: privileges
        .toUpperCase()
        .split(',')
        .map((privilege) => privilege.trim()),
      objectKind,
      /** `public.name` for a table; `public.name` without the argument list for a function. */
      object: plain(object.replace(/\(.*$/, '')),
      /**
       * Every role this statement reaches.
       *
       * PUBLIC is not a role name here but a synonym for all of them, so a GRANT to PUBLIC counts
       * against both browser roles - which is the hole this replaces: the table replay only
       * looked at statements that NAMED `anon` or `authenticated`, so `GRANT INSERT ... TO PUBLIC`
       * granted a write to every signed-in user and the check still said OK.
       */
      roles: named === 'public' ? [...CLIENT_ROLES, 'public'] : [named],
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
  // `pg_dump` output is not a promise about which spelling it uses.
  if (!new RegExp(String.raw`CREATE TABLE (?:IF NOT EXISTS )?"public"\."${table}"`).test(dump)) {
    problems.push(`${object} is not in the deployed schema`);
    continue;
  }
  for (const [role, permitted] of Object.entries(PERMITTED_TABLE_PRIVILEGES)) {
    const held = new Set();
    for (const statement of statements) {
      if (statement.action === 'DEFAULT') continue;
      // A statement naming the whole schema reaches this table too.
      const namesTable =
        (statement.objectKind === 'TABLE' && statement.object === object) ||
        (statement.objectKind === 'ALL TABLES IN SCHEMA' && statement.object === 'public');
      if (!namesTable) continue;
      if (!statement.roles.includes(role)) continue;
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
    for (const role of statement.roles) {
      if (statement.action === 'GRANT') executors.add(role);
      else executors.delete(role);
    }
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

/** Everything in `public` that is not a boundary function and not the platform's own. */
const helpers = [...functions.keys()].filter(
  (name) => !BOUNDARY_FUNCTIONS.includes(name) && !PLATFORM_FUNCTIONS.includes(name),
);

for (const name of EXPECTED_HELPERS) {
  if (!functions.has(name)) {
    problems.push(`public.${name} is not in the deployed schema`);
  }
}

for (const name of helpers) {
  for (const statement of statements) {
    if (statement.objectKind !== 'FUNCTION' || statement.object !== `public.${name}`) continue;
    if (statement.action !== 'GRANT') continue;
    for (const role of statement.roles) {
      if (CLIENT_ROLES.includes(role)) {
        problems.push(
          `public.${name} is executable by ${role}, and a function the boundary calls is ` +
            'surface with no purpose outside the functions that call it (ADR-0012, I-4)',
        );
      }
    }
  }
}

/**
 * Default privileges on tables, which decide what the NEXT table arrives holding.
 *
 * Supabase configures `ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES` to `postgres`, `anon`,
 * `authenticated` and `service_role` on every project. ADR-0011 records the decision not to change
 * that on the development project - it is platform behaviour with consequences for Supabase's own
 * tooling, and the authorisation in hand is development-only - and recommends revoking it before
 * production holds data.
 *
 * So the platform's own set is reported as the condition it is, not as a failure: every existing
 * table is asserted above, and a table added later is caught by the migration gate, which starts
 * its privilege replay from exactly this ALL and refuses a migration that does not take it away.
 * A default privilege for any OTHER role is not the platform's and is refused.
 */
const PLATFORM_DEFAULT_ROLES = ['postgres', 'anon', 'authenticated', 'service_role'];
const defaultRoles = new Set();
for (const statement of statements) {
  if (statement.action !== 'DEFAULT') continue;
  for (const role of statement.roles) {
    defaultRoles.add(role);
    if (!PLATFORM_DEFAULT_ROLES.includes(role)) {
      problems.push(
        `the schema sets default privileges granting ${statement.privileges.join(', ')} on ` +
          `tables to ${role}, which is not the platform's own set, so a table added later ` +
          'arrives granted them (ADR-0012, I-2)',
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
      `pinned search_path, and ${String(helpers.length)} other functions in public are callable ` +
      'by no client role.\n' +
      `  Noted, as ADR-0011 records: the platform's default privileges still grant ALL on a new ` +
      `table in public to ${[...defaultRoles].sort().join(', ') || 'nobody'}. Every existing ` +
      'table is asserted above, and the migration gate refuses a migration that leaves a new ' +
      'one that way.',
  );
  process.exit(0);
}

console.error(`check-db-boundary: FAILED — ${String(problems.length)} problems:`);
for (const problem of problems) console.error(`  ${problem}`);
console.error('\nSee docs/adr/0012-one-trusted-write-boundary.md.');
process.exit(1);
