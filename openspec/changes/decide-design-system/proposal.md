## Why

Every web scaffold arrives with a visual opinion attached. Accepting it would establish this
product's visual language as a side effect of running a generator — a decision nobody made,
expensive to reverse once components are built on it, and producing a UI that looks like a
template rather than like this product.

This product is also unusually constrained visually. It is used one-handed, mid-set, on a
phone, sometimes offline, by someone out of breath. Those constraints deserve a deliberate
design pass.

That pass has now happened. The owner decided all 65 questions of a design-system workbook
and submitted the payload on 2026-09-17 (0 unresolved, 0 deferred). This change records that
decision normatively and implements it as tokens, components, a Storybook lab, identity assets, and
gates.

Serves: D-002, D-021, R-004, R-007, R-010, R-022. See
`docs/adr/0008-quiet-performance-design-system.md`, which supersedes ADR-0007.

## What Changes

- Records the owner's payload verbatim, traces every selected option to where it is
  implemented and what proves it, and records the workbook's defaults and deferrals.
- Rewrites `DESIGN_SYSTEM.md` to `Accepted` (Quiet Performance 1.0.0), with a reconciliation
  log and an explicit validation status that keeps gate G-10 open.
- Adds DTCG 2025.10 design tokens in two tiers with a generator and drift, integrity, and
  contrast tests.
- Adds closed-variant primitives and patterns in `apps/web/ui`, vendored Lucide outline icons
  with a licence ledger, an English catalogue with ICU plurals, the theme bootstrap, and
  device feedback preferences. No UI framework, component library, icon package, or font file
  is added.
- Restyles the shell and ships the accepted identity: manifest, icons, and theme colour. The
  inventory, state matrix, and coded reference screens are Storybook stories; by owner decision
  on 2026-09-17 Storybook is the only lab and the earlier `/lab` routes are removed (ADR-0010).
- Adds the `test:visual` gate with per-platform baselines, and extends the accessibility and
  behaviour gates.
- Implements **no product feature**. The reference screens run on fixtures.

## Capabilities

### New Capabilities
- `design-system`: the accepted visual and interaction system, how it is encoded and
  enforced, and how acceptance differs from validation.

### Modified Capabilities
- `engineering-gates`: adds the visual-regression gate to the required gate suite.

## Impact

**Affected:** `apps/web`, `DESIGN_SYSTEM.md`, `docs/design-system/`, `docs/adr/`,
`docs/external-gates.md`, and — in separate guardrail commits — `playwright.config.ts`,
`vitest.config.ts`, `scripts/verify.mjs`, `scripts/serve-static.mjs`,
`scripts/policy-consistency.test.ts`, `.github/workflows/verify.yml`, and `ENGINEERING.md`. No
shared package below the presentation layer changes; dependency direction is unchanged. One
dependency was added: Storybook, at exact versions, as the reviewed dependency change the owner
approved on 2026-09-17 (ADR-0010).

**Unblocks:** changes that implement substantive UI, which now build on `apps/web/ui`.

**Delivered since acceptance (2026-09-17).** Storybook is the only design-system lab: the
separate `/lab` routes are gone, and every primitive, pattern, state, and reference screen is a
categorised story served from the static build (ADR-0010). The proposal review UX and its
baselines are in place (task 5.6). Linux baselines are generated and committed, verified in
`mcr.microsoft.com/playwright:v1.63.0-noble` (linux/amd64) only after every target rendered
identically twice in every project, and `.github/workflows/verify.yml` runs in that image pinned
by digest, so the visual gate is expected to pass in CI rather than fail there.

**Still open (gate G-10):** the canonical list is `DESIGN_SYSTEM.md`, Validation status. It
includes target-user use of the critical journeys (R-022), the manual accessibility matrix with
real assistive technology and a human colour-vision review, a GitHub Actions run of the verify
workflow (no remote exists, gate G-1), final owner approval of the exact committed baseline set,
and the real-device install, vibration, and tone checks.
