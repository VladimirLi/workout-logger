#!/usr/bin/env node
/**
 * Deny-by-default, against a real database (identity spec, task 2.3; R-013).
 *
 * The migration gate proves the SQL says the right thing. This proves the database does it:
 * every exposed table is read and written through PostgREST with the anonymous key, and every
 * attempt must be refused.
 *
 * NOT part of `pnpm verify`. It needs a network and a credential, and the aggregate gate has
 * to stay hermetic and secret-free. Run it against the development project deliberately:
 *
 *   node --env-file=.env.local scripts/check-rls.mjs
 *
 * It fails rather than skips when the environment is missing, because "no credential, so no
 * finding" is the vacuous pass this check exists to prevent.
 *
 * GUARDRAIL FILE. It never prints a credential: only status codes and table names.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLES = [
  'plans',
  'workout_sessions',
  'recorded_sets',
  'session_corrections',
  'proposals',
  'idempotency_records',
];

if (!url || !publishableKey) {
  console.error(
    'check-rls: FAILED — NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required.\n' +
      '  Run: node --env-file=.env.local scripts/check-rls.mjs',
  );
  process.exit(1);
}

const headers = {
  apikey: publishableKey,
  'Content-Type': 'application/json',
};

/** A refusal is a 401/403, or a 200 that returns no rows: RLS filters rather than errors. */
async function attempt(table, method, body) {
  const response = await fetch(`${url}/rest/v1/${table}${method === 'GET' ? '?select=*' : ''}`, {
    method,
    headers: method === 'GET' ? headers : { ...headers, Prefer: 'return=representation' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, empty: text.trim() === '[]', text: text.slice(0, 120) };
}

const problems = [];

for (const table of TABLES) {
  const read = await attempt(table, 'GET');
  const refusedRead =
    read.status === 401 || read.status === 403 || (read.status === 200 && read.empty);
  if (!refusedRead) {
    problems.push(`${table}: anonymous SELECT returned ${read.status} with rows — ${read.text}`);
  }

  // A write the policy must refuse. The payload is deliberately invalid for the schema too,
  // so a table that somehow accepted it would still not be left with a row.
  const write = await attempt(table, 'POST', { user_id: '00000000-0000-4000-8000-000000000000' });
  const refusedWrite = write.status === 401 || write.status === 403;
  if (!refusedWrite) {
    problems.push(`${table}: anonymous INSERT returned ${write.status} — ${write.text}`);
  }

  console.log(
    `  ${table}: SELECT ${read.status}${read.empty ? ' (no rows)' : ''}, INSERT ${write.status}`,
  );
}

if (problems.length > 0) {
  console.error(`\ncheck-rls: FAILED — ${problems.length} problems:`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `\ncheck-rls: OK — ${TABLES.length} tables refuse an anonymous read and an anonymous write.\n` +
    "  Wrong-user denial is task 2.3's other half and needs two signed-in identities, which\n" +
    '  needs authentication (G-2 auth configuration, G-4).',
);
process.exit(0);
