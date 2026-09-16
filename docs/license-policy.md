# License policy

**Status:** Normative. Machine-enforced by `pnpm test:licenses`.
**Source:** R-029. Guardrail file — see [ENGINEERING.md](../ENGINEERING.md).

## Allowed without exception

Applies to distributed runtime dependencies.

`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `Zlib`,
`BlueOak-1.0.0`, `Python-2.0`, `Unlicense`

Also allowed as SPDX combinations: a disjunction when any disjunct is allowed, a
conjunction when every conjunct is allowed, e.g. `(MIT OR Apache-2.0)`, `MIT AND ISC`.

`A WITH B` is classified by licence `A` **only** when `B` is a recognised, current SPDX
exception identifier **and** the pairing `A`+`B` is listed in `scripts/spdx-exceptions.json`,
e.g. `Apache-2.0 WITH LLVM-exception`. An exception changes the terms of the licence it is
attached to, so an unrecognised exception (`Apache-2.0 WITH Totally-Made-Up-exception`), a
real exception on a licence it does not modify (`MIT WITH Classpath-exception-2.0`), a
deprecated identifier, a case variant, or a malformed expression is **unknown**, which fails
closed. The recognised list is a verbatim copy of `spdx-exceptions@2.5.0`, verified
byte-for-byte against the frozen install; the pairing table is project-owned, and adding a
pairing is a guardrail change.

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

### Owner decision LIC-2026-09-16

**Approver:** Vladimir · **Decided:** 2026-09-16 · **Valid through:** 2027-09-16 (inclusive)

> Approve all 12 with the stated conditions through 2027-09-16.

**Conditions** — presented to and accepted by the owner:

1. product remains privately hosted
2. no npm package, binary, desktop bundle, or redistributable build is published
3. dependencies remain unmodified
4. CI verifies exact package versions and scopes against the ledger
5. any distribution plan, material dependency change, or expired review date blocks release and requires new review

The decision covers **exactly the twelve component@version entries below, and nothing
else.** It does not approve a later version of any of them, a different scope, a changed
licence expression, or any new component. Each of those is a new decision.

### How each condition is enforced

`pnpm test:licenses` fails with exit **1** on any breach. A breach voids the approval; the
remedy is new owner review, **not** editing an entry to match the new state.

| Condition | Mechanism |
|---|---|
| Privately hosted, nothing published | Every workspace manifest must be `"private": true` with no `publishConfig`; no package script or workflow may run `npm/pnpm/yarn publish` or `changeset publish`, or configure a `publish:` step |
| No binary, desktop bundle, or redistributable build | Fails on a dependency on electron, electron-builder, Electron Forge, Tauri, pkg, nexe, postject, or Neutralino, and on a script building a single executable (`--experimental-sea-config`, `bun build --compile`, `deno compile`) |
| Dependencies remain unmodified | Fails on a `patchedDependencies` entry, patch file, or `overrides`/`resolutions` targeting an excepted component, and on any `.pnpmfile`, whose hooks can rewrite any manifest. CI installs with `--frozen-lockfile`, so the store verifies package integrity on install |
| Exact versions and scopes verified against the ledger | Each entry matches only its exact `component@version`; its recorded scope must equal the tree's (runtime wins when both); its recorded SPDX expression must equal the installed one |
| Material dependency change blocks | An entry no longer present, or no longer needed because the licence became allowed, fails as stale; a duplicate entry fails |
| Expired review date blocks | Valid through the end of 2027-09-16 UTC; from the next instant the gate fails |
| No fabricated approval | A named approver counts only if a recorded decision by that approver lists the exact component, records its conditions, and lasts at least as long as the entry |

Mechanical detection has a limit, stated plainly: a distribution plan that leaves no trace in
the repository cannot be detected. That is why the condition is recorded here as well as
enforced where it can be.

### One exception was eliminated rather than approved

`@img/sharp-libvips-darwin-arm64` (**LGPL-3.0-or-later**, runtime) is gone. `sharp` is an
*optional* dependency of Next.js used only for image optimization this product does not
use, so it is excluded via `ignoredOptionalDependencies` in `pnpm-workspace.yaml`, and
`images.unoptimized` in `apps/web/next.config.ts` makes the consequence explicit. That
removed the only copyleft component from the shipped dependency tree.

`lightningcss` could not be removed the same way: it is a hard `dependencies` entry of
`vite`, not an optional one.

### Approved ledger

| Component@version | SPDX | Scope | Why present | Linkage / distribution | Why no alternative | Obligations | Cost of removal | Approver | Review by |
|---|---|---|---|---|---|---|---|---|---|
| `@axe-core/playwright@4.13.0` | `MPL-2.0` | dev | Automated accessibility scanning in the Playwright a11y gate. | Dev-only test tooling. Never imported by shipped code, never bundled. | axe-core is the de facto engine for automated WCAG checks; no permissively licensed equivalent of comparable coverage exists. | MPL-2.0 is file-level copyleft on modification. The files are unmodified and not distributed. | Lose `pnpm test:a11y`. D-037 and R-007 both require automated accessibility checks. | **Vladimir** | 2027-09-16 |
| `@azu/style-format@1.0.1` | `WTFPL` | dev | Output formatting inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | WTFPL imposes no conditions. Recorded because it is not on the R-029 allowlist, not because it creates an obligation. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `axe-core@4.13.0` | `MPL-2.0` | dev | Accessibility rule engine underneath @axe-core/playwright. | Dev-only test tooling. Never bundled. | Bundled by @axe-core/playwright; not separately selectable. | Unmodified, not distributed. | Same as @axe-core/playwright: lose the accessibility gate. | **Vladimir** | 2027-09-16 |
| `binaryextensions@6.11.0` | `Artistic-2.0` | dev | Binary-file detection inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Artistic-2.0 is OSI-approved and permissive for unmodified use. Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `caniuse-lite@1.0.30001810` | `CC-BY-4.0` | runtime | Browser-support data table, a hard dependency of next@16 for target resolution. | Build-time data. Consumed by the compiler; the dataset is not emitted into the client bundle. | Non-optional transitive dependency of Next.js. Not selectable, not replaceable without replacing Next.js. | Attribution if the dataset is redistributed. Nothing is redistributed: the product is a privately hosted server application. | Replacing Next.js. This is the only runtime-scope exception remaining. | **Vladimir** | 2027-09-16 |
| `editions@6.22.0` | `Artistic-2.0` | dev | Module-edition resolution inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `istextorbinary@9.5.0` | `Artistic-2.0` | dev | Text/binary detection inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `lightningcss@1.33.0` | `MPL-2.0` | dev | CSS transform inside vite, which vitest depends on. | Dev-only test tooling. Never bundled. A hard dependency of vite, not an optional one. | Non-optional transitive dependency of vitest. Verified: vite declares it under `dependencies`, so it cannot be excluded as an optional dependency the way sharp was. | Unmodified, not distributed. | Replacing vitest, and with it every unit, domain and integration test. | **Vladimir** | 2027-09-16 |
| `spdx-exceptions@2.5.0` | `CC-BY-3.0` | dev | SPDX exception identifier list, reached through secretlint -> read-pkg -> normalize-package-data -> validate-npm-package-license. | Dev-only data. Never bundled. | Canonical SPDX data; there is no alternative source, and it is a transitive dependency of secretlint. | Attribution on redistribution of the dataset. Not redistributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `spdx-license-ids@3.0.23` | `CC0-1.0` | dev | SPDX licence identifier list, reached through the same secretlint chain. | Dev-only data. Never bundled. | Canonical SPDX data; transitive dependency of secretlint. | CC0-1.0 is a public-domain dedication and imposes no conditions. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `textextensions@6.11.0` | `Artistic-2.0` | dev | Text-extension list inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `version-range@4.15.0` | `Artistic-2.0` | dev | Semver-range handling inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |

Only one entry is **runtime** scope: `caniuse-lite`, build-time browser data behind Next.js.
The other eleven are dev tooling for three gates D-037 requires — accessibility
(`axe-core`), secret scanning (the `secretlint` chain, which accounts for eight of them),
and unit testing (`lightningcss`, via vitest).

### Future exceptions

A new exception is added with `approver` set to `pending-owner-approval`. The gate exits
**3 — BLOCKED: owner approval required** and prints its ledger row until the owner decides,
at which point a new decision record listing the exact component is added alongside the
approver name. An agent never writes an approver name without a decision the owner actually
made.

Every exception records `spdx`, `scope`, `use`, `linkage`, `noAlternative`, `obligations`,
`replacementCost`, `approver`, and `reviewBy`, the last as a plain `YYYY-MM-DD` date no more
than 12 months out. A bare entry is a bypass, not an exception.

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
