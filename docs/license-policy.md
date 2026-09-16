# License policy

**Status:** Normative. Machine-enforced by `pnpm test:licenses`.
**Source:** R-029. Guardrail file — see [ENGINEERING.md](../ENGINEERING.md).

## Allowed without exception

Applies to distributed runtime dependencies.

`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `Zlib`,
`BlueOak-1.0.0`, `Python-2.0`, `Unlicense`

Also allowed as SPDX combinations when every disjunct or conjunct is itself allowed,
e.g. `(MIT OR Apache-2.0)`, `Apache-2.0 WITH LLVM-exception`, `MIT AND ISC`.

## Rejected

`AGPL-*`, `SSPL-*`, `BUSL-*`, Commons Clause, `Elastic-2.0`, any non-commercial license,
the JSON license (`JSON`), and **any unresolved or unknown license** in a distributed
runtime dependency.

"Unknown" is a rejection, not a warning. A dependency whose license cannot be determined
is treated as prohibited until someone determines it.

## Requires review

`LGPL-*`, `MPL-*`, `EPL-*`, `CDDL-*`, `GPL-*`, and dual-license expressions that mix an
allowed and a review-required term.

Review is based on **actual linkage and distribution** — a copyleft library that is
dynamically linked and not modified sits differently from one bundled into a client
payload. The reviewer records the analysis as an exception below.

## Dev-only tooling

Evaluated separately from shipped code. A build tool that never ships to a user does not
impose distribution obligations on the product. Dev dependencies are still scanned;
`AGPL`, `SSPL`, `BUSL`, and Elastic-licensed **dev** tooling still require an exception
entry, because "dev-only" can change quietly.

## Exceptions

**The gate fails closed on an unapproved exception.** R-029 requires a **named approver**,
because an agent's licence analysis is not a substitute for a human's. `pnpm test:licenses`
exits **3 — BLOCKED: owner approval required** while any entry below reads
`pending-owner-approval`, and prints this ledger so the decision can be made from the
output. Exit **1** means something different: a policy violation in the tree, which is a
code change.

### One exception was eliminated rather than approved

`@img/sharp-libvips-darwin-arm64` (**LGPL-3.0-or-later**, runtime) is gone. `sharp` is an
*optional* dependency of Next.js used only for image optimization this product does not
use, so it is excluded via `ignoredOptionalDependencies` in `pnpm-workspace.yaml`, and
`images.unoptimized` in `apps/web/next.config.ts` makes the consequence explicit. That
removed the only copyleft component from the shipped dependency tree.

`lightningcss` could not be removed the same way: it is a hard `dependencies` entry of
`vite`, not an optional one.

### The load-bearing assumption

Every assessment below rests on the same fact: **this product is not distributed.** It is a
privately hosted, single-user server application. No npm package is published and no binary
is shipped to a user, so the copyleft obligations that attach on *distribution* are not
triggered. If that ever changes — a published package, a redistributable build, an external
user — **every exception here must be re-analysed before release.**

### Owner decision ledger

| Component@version | SPDX | Scope | Why present | Linkage / distribution | Why no alternative | Obligations | Cost of removal | Approver | Review by |
|---|---|---|---|---|---|---|---|---|---|
| `@axe-core/playwright@4.13.0` | `MPL-2.0` | dev | Automated accessibility scanning in the Playwright a11y gate. | Dev-only test tooling. Never imported by shipped code, never bundled. | axe-core is the de facto engine for automated WCAG checks; no permissively licensed equivalent of comparable coverage exists. | MPL-2.0 is file-level copyleft on modification. The files are unmodified and not distributed. | Lose `pnpm test:a11y`. D-037 and R-007 both require automated accessibility checks. | **pending-owner-approval** | 2027-09-16 |
| `@azu/style-format@1.0.1` | `WTFPL` | dev | Output formatting inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | WTFPL imposes no conditions. Recorded because it is not on the R-029 allowlist, not because it creates an obligation. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `axe-core@4.13.0` | `MPL-2.0` | dev | Accessibility rule engine underneath @axe-core/playwright. | Dev-only test tooling. Never bundled. | Bundled by @axe-core/playwright; not separately selectable. | Unmodified, not distributed. | Same as @axe-core/playwright: lose the accessibility gate. | **pending-owner-approval** | 2027-09-16 |
| `binaryextensions@6.11.0` | `Artistic-2.0` | dev | Binary-file detection inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Artistic-2.0 is OSI-approved and permissive for unmodified use. Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `caniuse-lite@1.0.30001810` | `CC-BY-4.0` | runtime | Browser-support data table, a hard dependency of next@16 for target resolution. | Build-time data. Consumed by the compiler; the dataset is not emitted into the client bundle. | Non-optional transitive dependency of Next.js. Not selectable, not replaceable without replacing Next.js. | Attribution if the dataset is redistributed. Nothing is redistributed: the product is a privately hosted server application. | Replacing Next.js. This is the only runtime-scope exception remaining. | **pending-owner-approval** | 2027-09-16 |
| `editions@6.22.0` | `Artistic-2.0` | dev | Module-edition resolution inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `istextorbinary@9.5.0` | `Artistic-2.0` | dev | Text/binary detection inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `lightningcss@1.33.0` | `MPL-2.0` | dev | CSS transform inside vite, which vitest depends on. | Dev-only test tooling. Never bundled. A hard dependency of vite, not an optional one. | Non-optional transitive dependency of vitest. Verified: vite declares it under `dependencies`, so it cannot be excluded as an optional dependency the way sharp was. | Unmodified, not distributed. | Replacing vitest, and with it every unit, domain and integration test. | **pending-owner-approval** | 2027-09-16 |
| `spdx-exceptions@2.5.0` | `CC-BY-3.0` | dev | SPDX exception identifier list, reached through secretlint -> read-pkg -> normalize-package-data -> validate-npm-package-license. | Dev-only data. Never bundled. | Canonical SPDX data; there is no alternative source, and it is a transitive dependency of secretlint. | Attribution on redistribution of the dataset. Not redistributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `spdx-license-ids@3.0.23` | `CC0-1.0` | dev | SPDX licence identifier list, reached through the same secretlint chain. | Dev-only data. Never bundled. | Canonical SPDX data; transitive dependency of secretlint. | CC0-1.0 is a public-domain dedication and imposes no conditions. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `textextensions@6.11.0` | `Artistic-2.0` | dev | Text-extension list inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |
| `version-range@4.15.0` | `Artistic-2.0` | dev | Semver-range handling inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **pending-owner-approval** | 2027-09-16 |

Only one entry is **runtime** scope: `caniuse-lite`, build-time browser data behind Next.js.
The other eleven are dev tooling for three gates D-037 requires — accessibility
(`axe-core`), secret scanning (the `secretlint` chain, which accounts for eight of them),
and unit testing (`lightningcss`, via vitest).

An expired review date is a gate failure. So is an exception missing any of `spdx`, `scope`,
`use`, `linkage`, `noAlternative`, `obligations`, `replacementCost`, `approver`, or
`reviewBy` — a bare entry is a bypass, not an exception.

## Enforcement

`pnpm test:licenses` resolves the SPDX expression of every workspace dependency from the
committed lockfile and fails on any rejected or unknown license that is not covered by an
unexpired exception. It runs offline. The allow/reject/review lists live in
`scripts/license-policy.json`, which is the single source the checker reads — this
document and that file must agree, and a test asserts they do.

## SBOM

An SPDX or CycloneDX SBOM is generated for every release, together with signed provenance
(R-029, R-026). SBOM generation runs offline from the lockfile; publication and
attestation require a GitHub remote — see [external-gates.md](external-gates.md) § G-7.
