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

/** Tables the migration revokes from PUBLIC or anon: deny-by-default, stated. */
function revokedTables(sql) {
  const pattern = /\bREVOKE\s+[^;]*?\bON\s+(?:TABLE\s+)?([a-z_][\w.]*)\s+FROM\s+([^;]+)/gi;
  const revoked = new Set();
  for (const match of sql.matchAll(pattern)) {
    if (/\b(public|anon)\b/i.test(match[2])) revoked.add(qualify(match[1]));
  }
  return revoked;
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
  const revoked = revokedTables(sql);
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
