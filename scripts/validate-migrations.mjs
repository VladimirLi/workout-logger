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
