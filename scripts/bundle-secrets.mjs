#!/usr/bin/env node
/**
 * No privileged credential in the client bundle (first-vertical-slice task 2.7, R-020).
 *
 * A service-role key reaching the browser hands every row of every user's data to anyone who
 * opens developer tools. It is the kind of mistake that happens by autocomplete - one
 * environment variable named without the NEXT_PUBLIC_ prefix, or one server module imported
 * from a client component - and nothing about the running application looks different
 * afterwards.
 *
 * secretlint scans the SOURCE. This scans what the browser is actually served, which is the
 * only place the answer is authoritative. It runs after the build in `pnpm verify`.
 *
 * GUARDRAIL FILE.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const BUNDLE = 'apps/web/.next';
const SERVED = [join(BUNDLE, 'static'), join(BUNDLE, 'server')];
const EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.map', '.html', '.txt']);

/**
 * What must never appear in something the browser can fetch. Names as well as values: a build
 * that inlines the NAME of a service-role variable has inlined its value somewhere too.
 */
const FORBIDDEN = [
  { pattern: /service_role/i, why: 'a service-role reference' },
  { pattern: /SUPABASE_SERVICE_ROLE_KEY/, why: 'the service-role key variable' },
  { pattern: /\bsk_live_[A-Za-z0-9]{8,}/, why: 'a live secret key' },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, why: 'a private key' },
  // A JWT whose payload names the service role. The middle segment is base64url JSON.
  {
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    why: 'a JSON Web Token',
    verify: (match) => {
      try {
        const payload = match.split('.')[1] ?? '';
        const json = Buffer.from(payload, 'base64url').toString('utf8');
        return /service_role|"role"\s*:\s*"(?!anon\b)/.test(json);
      } catch {
        return false;
      }
    },
  },
];

function* files(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* files(path);
      continue;
    }
    if (EXTENSIONS.has(extname(path))) yield path;
  }
}

if (!existsSync(BUNDLE)) {
  // Not a pass. Reporting "no credential found" without a bundle to look at would be the
  // vacuous success this whole gate exists to prevent.
  console.error(
    `bundle-secrets: FAILED — ${BUNDLE} does not exist, so nothing was scanned.\n` +
      '  Run `pnpm build` first; `pnpm verify` always does.',
  );
  process.exit(1);
}

const findings = [];
let scanned = 0;

for (const directory of SERVED) {
  for (const path of files(directory)) {
    scanned += 1;
    const content = readFileSync(path, 'utf8');
    for (const { pattern, why, verify } of FORBIDDEN) {
      const match = pattern.exec(content);
      if (!match) continue;
      if (verify && !verify(match[0])) continue;
      findings.push({ path, why });
    }
  }
}

if (scanned === 0) {
  console.error(
    `bundle-secrets: FAILED — ${BUNDLE} exists but held no files to scan.\n` +
      '  A build that produces nothing cannot be cleared of anything.',
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`bundle-secrets: FAILED — ${findings.length} findings in the built output:`);
  for (const { path, why } of findings) console.error(`  ${path}: ${why}`);
  console.error(
    '\nA privileged credential must never reach the client. Read it on the server only,\n' +
      'and expose to the browser exactly the anon key and nothing else (R-020).',
  );
  process.exit(1);
}

console.log(`bundle-secrets: OK — ${scanned} built files carry no privileged credential.`);
process.exit(0);
