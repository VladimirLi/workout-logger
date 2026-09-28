# License policy

**Status:** Normative. Machine-enforced by `pnpm test:licenses`.
**Source:** R-029. Guardrail file — see [ENGINEERING.md](../ENGINEERING.md).

## Allowed without exception

Applies to distributed runtime dependencies.

`MIT`, `ISC`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `0BSD`, `Zlib`,
`BlueOak-1.0.0`, `Python-2.0`, `Unlicense`

Also allowed as SPDX combinations: a disjunction when any disjunct is allowed, a
conjunction when every conjunct is allowed, e.g. `(MIT OR Apache-2.0)`, `MIT AND ISC`.

SPDX expression parsing is delegated to `pnpm licenses`; the repository does not maintain its
own parser or exception registry.

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

### Owner decision LIC-2026-09-26

**Approver:** Vladimir · **Decided:** 2026-09-26 · **Valid through:** 2027-09-16 (inclusive)

> Approve the same 12 exact exceptions through 2027-09-16 for a public MIT source repository, provided dependencies remain unmodified and neither dependency sources nor npm/binary bundles are published

**Conditions** — presented to and accepted by the owner:

1. the public repository contains project source under the MIT License
2. dependencies remain unmodified
3. neither dependency sources nor npm/binary bundles are published

The decision covers **exactly the twelve component@version entries below, and nothing
else.** It does not approve a later version of any of them, a different scope, a changed
licence expression, or any new component. Each of those is a new decision.

### How each condition is enforced

`pnpm test:licenses` runs the maintained `license-checker-rseidelsohn` package over
production dependencies with exact `package@version` exclusions. GitHub Dependency Review
enforces the same allowed licences and exact exceptions on every pull request. Frozen lockfile
installation makes changed dependency versions visible in the pull request.

The approval conditions about modification and publication are owner policy, not executable
facts. They remain recorded here rather than being represented by a custom policy engine that
could only detect selected repository shapes.

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
| `caniuse-lite@1.0.30001810` | `CC-BY-4.0` | runtime | Browser-support data table, a hard dependency of next@16 for target resolution. | Build-time data. Consumed by the compiler; the dataset is not emitted into the client bundle. | Non-optional transitive dependency of Next.js. Not selectable, not replaceable without replacing Next.js. | Attribution if the dataset is redistributed. The public repository does not publish the dependency dataset, and the application build does not emit it. | Replacing Next.js. This is the only runtime-scope exception remaining. | **Vladimir** | 2027-09-16 |
| `editions@6.22.0` | `Artistic-2.0` | dev | Module-edition resolution inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `istextorbinary@9.5.0` | `Artistic-2.0` | dev | Text/binary detection inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `lightningcss@1.33.0` and its exact `1.33.0` platform-native artifacts | `MPL-2.0` | dev | CSS transform inside vite, which vitest depends on. The wrapper selects one matching native package at install time. | Dev-only test tooling. Never bundled. A hard dependency of vite, not an optional one. | Non-optional transitive dependency of vitest. Verified: vite declares it under `dependencies`, so it cannot be excluded as an optional dependency the way sharp was. | Unmodified, not distributed. | Replacing vitest, and with it every unit, domain and integration test. | **Vladimir** | 2027-09-16 |
| `spdx-exceptions@2.5.0` | `CC-BY-3.0` | dev | SPDX exception identifier list, reached through secretlint -> read-pkg -> normalize-package-data -> validate-npm-package-license. | Dev-only data. Never bundled. | Canonical SPDX data; there is no alternative source, and it is a transitive dependency of secretlint. | Attribution on redistribution of the dataset. Not redistributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `spdx-license-ids@3.0.23` | `CC0-1.0` | dev | SPDX licence identifier list, reached through the same secretlint chain. | Dev-only data. Never bundled. | Canonical SPDX data; transitive dependency of secretlint. | CC0-1.0 is a public-domain dedication and imposes no conditions. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `textextensions@6.11.0` | `Artistic-2.0` | dev | Text-extension list inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |
| `version-range@4.15.0` | `Artistic-2.0` | dev | Semver-range handling inside secretlint. | Dev-only tooling in the secret-scanning gate. Unmodified, never bundled. | Transitive dependency of secretlint. | Unmodified, not distributed. | Lose `pnpm test:secrets`, the only secret gate that runs on every contributor machine. D-037 requires secret scanning. | **Vladimir** | 2027-09-16 |

Only one entry is **runtime** scope: `caniuse-lite`, build-time browser data behind Next.js.
The other eleven are dev tooling for three gates D-037 requires — accessibility
(`axe-core`), secret scanning (the `secretlint` chain, which accounts for eight of them),
and unit testing (`lightningcss`, via vitest).

### Owner decision LIC-2026-09-28

**Approver:** Vladimir · **Decided:** 2026-09-28 · **Valid through:** 2027-09-16 (inclusive)

> Approve `spdx-satisfies@6.0.0` as a dev-only exception in GitHub Dependency Review, under
> the same conditions as LIC-2026-09-26.

This corrects a detection false positive. GitHub Dependency Review reports the package as
`Apache-2.0 AND BSD-2-Clause AND GPL-2.0-only AND MIT`. The published tarball declares
`"license": "MIT"` and ships an MIT `LICENSE` file; `GPL` appears only as data in `index.js`
(GPL "only" and "or later" range handling) and in README usage examples. `pnpm test:licenses`
reads the declared licence and passes, so the exception exists only in
`.github/workflows/security.yml`. The decision covers exactly `spdx-satisfies@6.0.0`; a later
version is a new decision.

| Component@version | SPDX | Scope | Why present | Linkage / distribution | Why no alternative | Obligations | Cost of removal | Approver | Review by |
|---|---|---|---|---|---|---|---|---|---|
| `spdx-satisfies@6.0.0` | `MIT` (detected as `Apache-2.0 AND BSD-2-Clause AND GPL-2.0-only AND MIT`) | dev | SPDX expression matching inside `license-checker-rseidelsohn@5`, which runs `pnpm test:licenses`. | Dev-only tooling in the licence gate. Unmodified, never bundled. | Hard dependency of `license-checker-rseidelsohn@5`. | MIT notice on redistribution. Not redistributed. | Stay on `license-checker-rseidelsohn@4`, or replace the licence gate. | **Vladimir** | 2027-09-16 |

### Future exceptions

New package exceptions require owner review before they are added to the tool configuration.
Record the rationale and conditions here; do not build a parallel approval workflow in code.

## Enforcement

`pnpm test:licenses` checks all dependencies locally. `.github/workflows/security.yml`
runs GitHub Dependency Review on pull requests and rejects AGPL, SSPL, BUSL, Elastic, Commons
Clause, JSON, non-commercial, and copyleft additions unless explicitly approved.

## SBOM

An SPDX or CycloneDX SBOM is generated for every release, together with signed provenance
(R-029, R-026). SBOM generation runs offline from the lockfile; publication and
attestation require a GitHub remote — see [external-gates.md](external-gates.md) § G-7.
