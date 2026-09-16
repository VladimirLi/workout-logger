#!/usr/bin/env node
/**
 * CycloneDX SBOM generation (R-029, R-026).
 *
 * Delegates to pnpm's built-in generator with `--lockfile-only`, so the document is
 * produced deterministically from the committed lockfile with no network access and
 * no extra dependency.
 *
 * NOTE: the npm script is `sbom:generate`, not `sbom`. `pnpm sbom` is a built-in pnpm
 * command and would shadow a script of that name.
 *
 * Signing and attestation need GitHub OIDC and are external gates
 * (docs/external-gates.md, G-7). This produces the document; it does not claim the
 * document is attested.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT_DIR = 'artifacts';
const OUT_FILE = `${OUT_DIR}/sbom.cdx.json`;

let raw;
try {
  raw = execFileSync(
    'pnpm',
    [
      'sbom',
      '--sbom-format',
      'cyclonedx',
      '--sbom-spec-version',
      '1.6',
      '--sbom-type',
      'application',
      '--lockfile-only',
    ],
    { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 },
  );
} catch (error) {
  console.error('sbom: FAILED — could not generate the SBOM.');
  console.error(error?.stderr?.toString?.() ?? error?.message ?? String(error));
  process.exit(1);
}

let document;
try {
  document = JSON.parse(raw);
} catch {
  console.error('sbom: FAILED — generator output was not valid JSON.');
  process.exit(1);
}

// Validate rather than trust. An SBOM that is present but malformed is worse than a
// missing one, because it satisfies a checklist without carrying the information.
const problems = [];
if (document.bomFormat !== 'CycloneDX') problems.push('bomFormat is not CycloneDX');
if (!document.specVersion) problems.push('specVersion is missing');
if (!Array.isArray(document.components)) problems.push('components is not an array');
if (Array.isArray(document.components) && document.components.length === 0) {
  problems.push('components is empty, so the SBOM describes nothing');
}
for (const component of document.components ?? []) {
  if (!component.name || !component.version) {
    problems.push(
      `a component is missing name or version: ${JSON.stringify(component).slice(0, 120)}`,
    );
    break;
  }
}

if (problems.length > 0) {
  console.error('sbom: FAILED — the generated document did not validate:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

/**
 * Strip the two volatile fields so two runs over the same lockfile produce a
 * byte-identical document. A reviewer can then diff yesterday's SBOM against
 * today's and see only real dependency changes, and the checksum recorded against a
 * release means something. The release identity comes from the git tag and the
 * provenance attestation, not from a wall-clock timestamp inside the file.
 */
delete document.serialNumber;
if (document.metadata) delete document.metadata.timestamp;

mkdirSync(OUT_DIR, { recursive: true });
const json = `${JSON.stringify(document, null, 2)}\n`;
writeFileSync(OUT_FILE, json);

const digest = createHash('sha256').update(json).digest('hex');
console.log(
  `sbom: wrote ${OUT_FILE} — CycloneDX ${document.specVersion}, ` +
    `${document.components.length} components, sha256:${digest}`,
);
