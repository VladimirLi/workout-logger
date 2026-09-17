# Engineering

**Status:** Normative. The gate list and the guardrail list are enforced by CI.
**Source:** Promoted from [docs/discovery/decision-record.md](docs/discovery/decision-record.md).

## Toolchain

Pinned. A clean machine needs only these.

| | |
|---|---|
| Node | 22.23.1 (`.nvmrc`); engines allow `^22.22.1 \|\| ^24 \|\| >=26` |
| Package manager | pnpm 11.5.2, pinned via `packageManager` |
| Language | TypeScript, strict, with project references |
| Format + lint | Biome (one tool, not Prettier + ESLint) |
| Tests | Vitest (unit, domain, integration), Playwright (E2E, a11y) |
| Architecture | dependency-cruiser |
| Specs | OpenSpec (`@fission-ai/openspec`) |

Dependency versions are pinned in the `catalog:` block of `pnpm-workspace.yaml`, so
two packages cannot disagree about a version. `pnpm-lock.yaml` is committed.

## Bootstrap

```bash
nvm use            # or any Node matching .nvmrc
corepack enable    # provides the pinned pnpm
pnpm install
pnpm verify
```

That must succeed on a clean checkout with **no undeclared global tools and no machine
state** (R-028). If it does not, that is a bug in this repository, not in your setup.

Playwright browsers install separately, once: `pnpm exec playwright install --with-deps chromium`.

## Canonical commands

Root scripts are the **only** CI interface (R-028, ADR-0006). CI invokes these; it never
inlines its own commands. That is what makes a green local run meaningful.

| Command | What it checks |
|---|---|
| `pnpm install` | Deterministic install from the committed lockfile |
| `pnpm dev` | Local development server |
| `pnpm format` / `pnpm format:check` | Formatting |
| `pnpm lint` | Lint rules |
| `pnpm typecheck` | Strict types across all project references |
| `pnpm test` | Unit and domain tests |
| `pnpm test:integration` | Use-case and adapter-contract tests |
| `pnpm test:e2e` | Browser smoke path |
| `pnpm test:a11y` | Automated accessibility checks |
| `pnpm test:visual` | Visual regression against committed per-platform baselines; a missing baseline fails |
| `pnpm test:architecture` | Dependency direction and cycles |
| `pnpm test:licenses` | License policy (exit 3 = blocked on owner approval) |
| `pnpm test:deps` | High/critical vulnerability block |
| `pnpm test:secrets` | Secret scanning |
| `pnpm test:migrations` | Migration expand-contract rules |
| `pnpm test:guardrails` | Guardrail/product co-change check |
| `pnpm spec:validate` | OpenSpec artifact validation |
| `pnpm build` | Production build |
| `pnpm sbom:generate` | CycloneDX SBOM from the lockfile |
| **`pnpm verify`** | **Every required non-deployment gate** |

`pnpm verify <gate>` runs a subset, e.g. `pnpm verify lint typecheck`.

## Gates fail honestly

Three rules, and they are not negotiable:

1. **A gate that cannot run is a failure, not a skip.** `pnpm test:deps` passes only on a
   completed audit. A registry error envelope, an incomplete report, unparseable output, or
   a non-zero exit its findings do not explain all fail it, because an audit that checked
   nothing must not report success.
2. **A gate that is not yet applicable detects that deterministically and says so.**
   `pnpm test:migrations` passes while `supabase/migrations/` does not exist, prints why,
   and starts enforcing the instant the first migration lands. It is not a stub that
   always passes.
3. **A gate blocked on a human decision is not a failing gate.** `pnpm test:licenses`
   exits **3** when every licence complies but an exception has no named approver, and
   `pnpm verify` reports it as `BLOCK` rather than `FAIL`, runs every other gate, and exits
   3. That state is real and is not clearable by code. See
   [docs/external-gates.md](docs/external-gates.md), G-11.
4. **Never weaken a gate to go green.** Not the coverage threshold, not the severity
   level, not the license allowlist, not a lint rule. If a gate is genuinely wrong, fix it
   in a separate guardrail change (below).

## Guardrails

An implementing agent **may not** change the gates that judge its implementation in the
same change (D-035). `pnpm test:guardrails` fails a change that touches both a guardrail
path and product code.

Guardrail paths:

```text
.github/workflows/
.dependency-cruiser.cjs
biome.json
tsconfig.base.json
vitest.config.ts
playwright.config.ts
.secretlintrc.json
commitlint.config.js
scripts/
pnpm-workspace.yaml
.husky/
SECURITY.md
OBSERVABILITY.md
ENGINEERING.md
docs/license-policy.md
packages/observability/
```

`packages/observability/` is a guardrail **in full**, not just its allowlist: the attribute
list is the telemetry privacy control and the rest of the package is what enforces it, so
protecting one without the other protects neither.

The canonical list is `scripts/guardrails.json`; a test asserts this document and that
file agree. Legitimate guardrail changes are submitted separately and reviewed by an
independent agent under the gates as they currently stand (D-036).

## Architecture

```text
apps  ->  adapters  ->  application  ->  domain
                            \-> contracts <-/
```

| Package | Rule |
|---|---|
| `packages/domain` | No workspace dependency, no framework, no I/O |
| `packages/contracts` | Schema library only |
| `packages/application` | Declares ports; never imports an adapter |
| `packages/adapters-*` | Imported only by an app composition root |
| `packages/observability` | The only package that may touch an OpenTelemetry SDK |
| `apps/web`, `apps/mcp` | Composition roots; they never import each other |

Cross-package deep imports are forbidden — every package has explicit Node `exports` and
that is its whole public surface. `pnpm test:architecture` enforces all of this plus cycle
detection. See [ADR-0001](docs/adr/0001-modular-monolith-with-provider-neutral-domain.md).

## Testing

Prioritize **high behavioral coverage of domain and application logic**, plus critical-path
integration and E2E coverage. A single global coverage percentage is explicitly **not** the
quality definition (D-038).

Coverage thresholds are therefore per-package: 95 % statements/lines on `packages/domain`
and `packages/observability`, where the behavior is. Skeletons are not padded to hit a
number.

Adapter correctness is proved by contract suites in `packages/test-support`, written
against the **port**. The in-memory reference implementation and any future provider
adapter run the identical suite.

## Commits and pull requests

Conventional commits, enforced by commitlint on `commit-msg` (D-010).

```text
<type>(<scope>): <lower-case subject>
```

Types: `feat fix docs refactor perf test build ci chore revert`.
Scopes: the workspace packages, plus `spec`, `guardrail`, `deps`, `release`, `repo`.

Pull requests must complete [`.github/pull_request_template.md`](.github/pull_request_template.md):
linked intent (OpenSpec change ID or maintenance rationale), the OpenSpec classification and
who verified it, evidence of gates, and the design-system dependency for any UI change.
Metadata is mandatory (D-010).

## Working on UI

The design system is **Accepted** ([DESIGN_SYSTEM.md](DESIGN_SYSTEM.md), ADR-0008, which
supersedes ADR-0007). UI work builds on it; it does not re-decide it.

- **Tokens only.** Colour, type, spacing, radius, motion, and layer values come from
  `apps/web/tokens/*.tokens.json` through the generated custom properties. A raw colour,
  pixel size, duration, or z-index in component CSS is a defect.
- **Screens import only from `apps/web/ui/`.** Primitives have closed variants and accept no
  `className`; the layout-only escape hatch is documented in DESIGN_SYSTEM.md.
- **No UI framework or component library.** Plain CSS with native custom properties, CSS
  Modules, no runtime CSS-in-JS. Icons are vendored Lucide outlines recorded in
  `apps/web/ui/icons/ICONS_LICENSES.md`; an icon not in that ledger fails `pnpm test`.
- **Change control is tiered** (governance.change-control.tiered): a foundation change
  (token tier, palette, type, spacing, motion) needs an ADR and an OpenSpec change; a
  component API change needs an OpenSpec change; a fix needs a PR note and, if pixels
  move, a baseline update.
- **Baselines.** `pnpm test:visual` never writes a baseline. `pnpm visual:update` does, and
  its output may be committed only in a visual-change PR approved by the owner. Baselines
  are per platform; see DESIGN_SYSTEM.md § Visual regression for the open Linux/CI gap.
- **Automated checks are not conformance.** `pnpm test:a11y` is the routine CI baseline
  (accessibility.testing.auto-only). Manual keyboard, screen-reader, zoom, orientation,
  contrast, and touch-target checks are still required before any conformance claim (R-007).

## Releases

Changesets drives semantic versioning and the changelog (D-041). A change that affects
released behavior adds a changeset; `pnpm changeset` writes it.

Automatic deployment on merge, automatic rollback on failed post-deployment verification
(D-042, D-043) depend on a hosting decision that has not been made — see
[docs/external-gates.md](docs/external-gates.md), G-4.

## What is not enforced here yet

Honest list. Each is an external gate, documented in
[docs/external-gates.md](docs/external-gates.md):

- Branch protection, required checks, signed commits, linear history (G-1).
- Anything requiring a database: RLS deny-by-default proofs, real migrations (G-2).
- Dependency review and CodeQL. Both need a remote, and both need the repository to be
  public or organization-owned with GitHub Advanced Security. On a personal private
  repository neither functions, and the local gates are the only coverage (G-6).
- Build provenance attestation, which needs GitHub OIDC and, in a private repository,
  GitHub Enterprise Cloud (G-7).

Until G-1 closes, "CI is authoritative" is documented intent rather than an enforced fact.
