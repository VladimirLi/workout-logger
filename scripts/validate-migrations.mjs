#!/usr/bin/env node
/**
 * Migration validation gate (D-037, R-016, R-017).
 *
 * No migrations exist yet, because no database exists yet (docs/external-gates.md,
 * G-2). This gate therefore has to do something specific: detect that condition
 * DETERMINISTICALLY, say so, and start failing the instant it becomes applicable.
 *
 * It is not a placeholder that always passes. It checks the directory, and every
 * migration it finds must satisfy the naming, ordering, and expand-contract rules
 * below or the gate fails.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';
const NAME_PATTERN = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;

/**
 * Statements that cannot be made compatible under expand-contract in one release,
 * or that take a lock long enough to queue application traffic (R-016).
 */
const DESTRUCTIVE_PATTERNS = [
  { pattern: /\bDROP\s+TABLE\b/i, why: 'DROP TABLE must be a separate contract migration' },
  { pattern: /\bDROP\s+COLUMN\b/i, why: 'DROP COLUMN must be a separate contract migration' },
  {
    pattern: /\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
    why: 'a column type change is not backward compatible',
  },
  { pattern: /\bRENAME\s+(?:COLUMN|TO)\b/i, why: 'a rename breaks the old application path' },
];

if (!existsSync(MIGRATIONS_DIR)) {
  console.log(
    `validate-migrations: not applicable — ${MIGRATIONS_DIR}/ does not exist.\n` +
      '  No database is provisioned yet (docs/external-gates.md, G-2).\n' +
      '  This gate begins enforcing the moment the first migration is added.',
  );
  process.exit(0);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log(
    `validate-migrations: not applicable — ${MIGRATIONS_DIR}/ exists but contains no migrations.`,
  );
  process.exit(0);
}

/** Tables a migration creates, as `schema.table`, defaulting to the public schema. */
function createdTables(sql) {
  const pattern = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w.]*)/gi;
  return [...sql.matchAll(pattern)].map((match) => qualify(match[1]));
}

function qualify(name) {
  const bare = name.replaceAll('"', '');
  return bare.includes('.') ? bare : `public.${bare}`;
}

/** Tables the migration turns row-level security on for. */
function securedTables(sql) {
  const pattern = /\bALTER\s+TABLE\s+([a-z_][\w.]*)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  return new Set([...sql.matchAll(pattern)].map((match) => qualify(match[1])));
}

/** Tables the migration grants something on, to anyone. */
function grantedTables(sql) {
  const pattern = /\bGRANT\s+[^;]*?\bON\s+(?:TABLE\s+)?([a-z_][\w.]*)/gi;
  return new Set([...sql.matchAll(pattern)].map((match) => qualify(match[1])));
}

/**
 * The privileges a client role holds on each table, replayed statement by statement.
 *
 * Fail closed, from what Supabase actually does rather than from what a migration says: default
 * privileges in `public` grant ALL on a new table to `anon` and `authenticated`, so a table
 * starts fully writable and a migration has to take that away. Two mistakes follow from
 * modelling it any other way, and the repository made both: revoking from `PUBLIC, anon` looks
 * like deny-by-default and leaves `authenticated` untouched, and revoking a named list leaves
 * whatever the list forgot - TRIGGER and, on Postgres 17, MAINTAIN.
 *
 * Replaying also catches the case a per-file check cannot see at all: a later migration granting
 * a write back.
 */
const TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];

/** The roles a browser can hold. `service_role` is the server's own and is not modelled. */
const CLIENT_ROLES = ['anon', 'authenticated'];

/** What a client role may still hold once every migration has run. */
const PERMITTED = { anon: [], authenticated: ['SELECT'] };

/** SQL with comments and function bodies removed, so only real statements are parsed. */
function statementsOf(sql) {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .split(';');
}

/**
 * Privilege changes to tables, in order. Anything that is not a table - a function, a schema, a
 * sequence, a default privilege - is not part of this model and is skipped.
 */
function privilegeChanges(sql) {
  const changes = [];
  for (const statement of statementsOf(sql)) {
    const match =
      /^\s*(GRANT|REVOKE)\s+([\s\S]+?)\s+ON\s+([\s\S]+?)\s+(?:TO|FROM)\s+([\s\S]+)$/i.exec(
        statement,
      );
    if (!match) continue;
    const [, action, privileges, target, roles] = match;
    if (
      /^\s*(FUNCTION|PROCEDURE|ROUTINE|SCHEMA|SEQUENCE|DATABASE|TYPE|DOMAIN|LARGE|FOREIGN|ALL)\b/i.test(
        target,
      )
    ) {
      continue;
    }
    const named = privileges.trim().toUpperCase();
    changes.push({
      action: action.toUpperCase(),
      privileges: /^ALL\b/.test(named)
        ? [...TABLE_PRIVILEGES]
        : named.split(',').map((privilege) => privilege.trim().split(/\s|\(/)[0]),
      tables: target
        .replace(/^\s*TABLE\s+/i, '')
        .split(',')
        .map((table) => qualify(table.trim())),
      // PUBLIC is asymmetric, and this is the asymmetry the repository got wrong: a GRANT to
      // PUBLIC reaches every role, while a REVOKE from PUBLIC takes away nothing that was
      // granted to a role directly - which is why `REVOKE ALL ... FROM PUBLIC, anon` left
      // `authenticated` holding everything Supabase's default privileges had given it.
      roles: (() => {
        const named = roles.split(',').map((role) => role.trim().replace(/"/g, '').toLowerCase());
        const direct = named.filter((role) => CLIENT_ROLES.includes(role));
        return action.toUpperCase() === 'GRANT' && named.includes('public')
          ? [...new Set([...direct, ...CLIENT_ROLES])]
          : direct;
      })(),
    });
  }
  return changes;
}

/**
 * Columns each policy's USING and WITH CHECK expressions compare, per table.
 *
 * An unindexed predicate column turns every policy check into a scan, which is a performance
 * problem that only appears once there is data - exactly the kind that reaches production.
 */
function policyPredicateColumns(sql) {
  const columns = new Map();
  const pattern = /\bCREATE\s+POLICY\s+[\w"]+\s+ON\s+([a-z_][\w.]*)([\s\S]*?);/gi;
  for (const match of sql.matchAll(pattern)) {
    const table = qualify(match[1]);
    const body = match[2] ?? '';
    const referenced = new Set();
    for (const comparison of body.matchAll(/\b([a-z_][a-z0-9_]*)\s*=/gi)) {
      const column = comparison[1].toLowerCase();
      // Keywords that can precede `=` in a policy body but are not columns.
      if (['using', 'check', 'select', 'and', 'or', 'not'].includes(column)) continue;
      referenced.add(column);
    }
    columns.set(table, new Set([...(columns.get(table) ?? []), ...referenced]));
  }
  return columns;
}

/**
 * Index coverage for a predicate column: a btree index or primary key whose LEADING column is
 * the one the policy compares. A composite key on (user_id, id) covers `user_id = ...`; the
 * same key does not cover a predicate on `id` alone.
 */
function leadingIndexedColumns(sql) {
  const covered = new Map();
  const add = (table, column) => {
    const key = qualify(table);
    covered.set(key, new Set([...(covered.get(key) ?? []), column.toLowerCase()]));
  };

  // PRIMARY KEY (a, b) and UNIQUE (a, b) inside a CREATE TABLE body.
  const tablePattern =
    /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w.]*)\s*\(([\s\S]*?)\n\);/gi;
  for (const match of sql.matchAll(tablePattern)) {
    const table = match[1];
    const body = match[2] ?? '';
    for (const key of body.matchAll(/\b(?:PRIMARY\s+KEY|UNIQUE)\s*\(\s*([\w"]+)/gi)) {
      add(table, key[1].replaceAll('"', ''));
    }
    // A column-level PRIMARY KEY or UNIQUE, as in `id text PRIMARY KEY`.
    for (const line of body.split('\n')) {
      const inline = /^\s*([a-z_][a-z0-9_]*)\s+[^,]*\b(PRIMARY\s+KEY|UNIQUE)\b/i.exec(line);
      if (inline) add(table, inline[1]);
    }
  }

  // CREATE [UNIQUE] INDEX ... ON table (a, ...)
  const indexPattern =
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?[\w"]+\s+ON\s+([a-z_][\w.]*)\s*(?:USING\s+\w+\s*)?\(\s*([\w"]+)/gi;
  for (const match of sql.matchAll(indexPattern)) add(match[1], match[2].replaceAll('"', ''));

  return covered;
}

const problems = [];
/** Public tables and the migration that created them, for the cumulative checks below. */
const createdIn = new Map();
/** Per table, the privileges each client role still holds as the migrations are replayed. */
const privileges = new Map();
const timestamps = [];

for (const file of files) {
  const match = NAME_PATTERN.exec(file);
  if (!match) {
    problems.push(`${file}: name must be <YYYYMMDDHHMMSS>_snake_case_description.sql`);
    continue;
  }
  timestamps.push(match[1]);

  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

  if (/\bCREATE\s+INDEX\b/i.test(sql) && !/\bCREATE\s+INDEX\s+CONCURRENTLY\b/i.test(sql)) {
    problems.push(`${file}: CREATE INDEX must be CONCURRENTLY, or it locks writes (R-016)`);
  }

  if (!/\bSET\s+(?:LOCAL\s+)?lock_timeout\b/i.test(sql)) {
    problems.push(`${file}: must set lock_timeout so it fails rather than queues traffic (R-016)`);
  }
  if (!/\bSET\s+(?:LOCAL\s+)?statement_timeout\b/i.test(sql)) {
    problems.push(`${file}: must set statement_timeout (R-016)`);
  }

  for (const { pattern, why } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(sql) && !/--\s*contract-migration:\s*approved/i.test(sql)) {
      problems.push(
        `${file}: ${why}. Add "-- contract-migration: approved" only after telemetry proves ` +
          'the old path is unused (R-016).',
      );
    }
  }

  if (/\bDOWN\b.*\bMIGRATION\b/i.test(sql) || /--\s*down\b/i.test(sql)) {
    problems.push(`${file}: automatic down-migrations are prohibited (R-017); recover forward`);
  }

  // Authorization, checked statically so a new table cannot arrive without it (identity spec,
  // tasks 2.2 and 2.4). Running deny-by-default tests against a live database is task 2.3.
  const created = createdTables(sql);
  const secured = securedTables(sql);
  const granted = grantedTables(sql);
  for (const table of created) {
    if (!table.startsWith('public.')) continue;
    createdIn.set(table, file);
    // Supabase's default privileges, which is the state a migration inherits.
    privileges.set(table, new Map(CLIENT_ROLES.map((role) => [role, new Set(TABLE_PRIVILEGES)])));
  }

  const revoked = new Set();
  for (const change of privilegeChanges(sql)) {
    for (const table of change.tables) {
      if (change.action === 'REVOKE' && change.roles.length > 0) revoked.add(table);
      const held = privileges.get(table);
      if (!held) continue;
      for (const role of change.roles) {
        const set = held.get(role);
        if (!set) continue;
        for (const privilege of change.privileges) {
          if (change.action === 'GRANT') set.add(privilege);
          else set.delete(privilege);
        }
      }
    }
  }
  // Stating deny-by-default in the file that creates the table, as well as ending up there.
  for (const statement of statementsOf(sql)) {
    const match = /^\s*REVOKE\s+[\s\S]+?\s+ON\s+([\s\S]+?)\s+FROM\s+([\s\S]+)$/i.exec(statement);
    if (match && /\b(public|anon)\b/i.test(match[2])) {
      for (const table of match[1]
        .replace(/^\s*TABLE\s+/i, '')
        .split(',')
        .map((table) => qualify(table.trim()))) {
        revoked.add(table);
      }
    }
  }
  const predicates = policyPredicateColumns(sql);
  const indexed = leadingIndexedColumns(sql);

  for (const table of created) {
    if (!table.startsWith('public.')) continue;
    if (!secured.has(table)) {
      problems.push(`${file}: ${table} is reachable and does not ENABLE ROW LEVEL SECURITY`);
    }
    if (!granted.has(table)) {
      problems.push(`${file}: ${table} has no explicit GRANT, so its access is implicit`);
    }
    if (!revoked.has(table)) {
      problems.push(`${file}: ${table} does not REVOKE from PUBLIC or anon (deny by default)`);
    }
    if (!predicates.has(table)) {
      problems.push(`${file}: ${table} has row-level security and no policy, so it is unreadable`);
    }
  }

  for (const [table, columns] of predicates) {
    for (const column of columns) {
      if (!indexed.get(table)?.has(column)) {
        problems.push(
          `${file}: ${table}.${column} is compared by a policy and is not the leading column ` +
            'of any index, so every check on it is a scan (task 2.4)',
        );
      }
    }
  }
}

/**
 * What a client role is left holding once every migration has run (ADR-0012, I-2).
 *
 * Checked across the whole set rather than per file, because a table created before this rule
 * existed is corrected by a later migration and an applied migration is not rewritten. The
 * final state is what the database enforces, so the final state is what is asserted.
 */
for (const [table, file] of createdIn) {
  const held = privileges.get(table) ?? new Map();
  for (const role of CLIENT_ROLES) {
    const leftover = [...(held.get(role) ?? new Set())]
      .filter((privilege) => !PERMITTED[role].includes(privilege))
      .sort();
    if (leftover.length > 0) {
      problems.push(
        `${table} (created in ${file}) still leaves ${role} holding ${leftover.join(', ')} ` +
          "after every migration. Supabase's default privileges grant ALL on a new table in " +
          'public to anon and authenticated, so revoke ALL PRIVILEGES from PUBLIC, anon, ' +
          `authenticated and grant back only ${PERMITTED[role].join(', ') || 'nothing'} ` +
          '(ADR-0012, I-2)',
      );
    }
  }
}

const sorted = [...timestamps].sort();
if (timestamps.join() !== sorted.join()) {
  problems.push('migration timestamps are not strictly ordered by filename');
}
if (new Set(timestamps).size !== timestamps.length) {
  problems.push('duplicate migration timestamps');
}

if (problems.length === 0) {
  console.log(
    `validate-migrations: OK — ${files.length} migrations satisfy the expand-contract rules.`,
  );
  process.exit(0);
}

console.error(`validate-migrations: FAILED — ${problems.length} problems:`);
for (const problem of problems) console.error(`  ${problem}`);
console.error('\nSee R-016/R-017 in docs/discovery/decision-record.md and docs/adr/0005-*.md.');
process.exit(1);
