# 0008 — Quiet Performance is the design system

**Status:** Accepted
**Date:** 2026-09-17
**Supersedes:** [0007](0007-design-system-deferred.md)
**Amended by:** [0010](0010-storybook-is-the-only-design-system-lab.md) (the `/lab` route)
**Discovery:** D-002, D-021, R-004, R-007, R-010, R-022

## Context

ADR-0007 made the design system a deliberate, separate decision and blocked substantive UI
until it was made. The owner then worked through a design-system workbook: 22 sections, 65
decisions, each with alternatives, a recommendation, and a rationale, alongside 146 defaults
and 22 explicit deferrals. On 2026-09-17 the owner submitted a payload selecting an option for
all 65 decisions, with none unresolved and none deferred.

The product constraints ADR-0007 named still hold: one-handed, mid-set, phone, sometimes
offline, out of breath.

## Decision

1. **Quiet Performance is the accepted design system**, as recorded in
   [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) (version 1.0.0). The owner's payload is kept
   verbatim and pinned by digest; every selected option is traced in
   [decision-matrix.md](../design-system/decision-matrix.md), and a policy test fails if one is
   missing or an unselected one appears.
2. **Tokens are the source of truth.** DTCG 2025.10 JSON in two tiers, core and semantic,
   generates CSS custom properties and a TypeScript table. Components use only semantic tokens.
3. **No UI framework, component library, icon package, or font file.** Plain CSS with custom
   properties and CSS Modules, closed-variant React components in `apps/web/ui`, and Lucide
   outline geometry vendored with its licence. The dependency tree and the LIC-2026-09-16
   ledger do not change.
4. **Visual regression is a required gate** (`pnpm test:visual`), with per-platform baselines,
   pinned fixtures, a repeatability test, and a 0.1 % threshold.
5. **Accepted is not validated.** Gate G-10 stays open until every item in DESIGN_SYSTEM.md,
   Validation status, has dated evidence: among them target-user use of the journeys (R-022),
   the manual accessibility matrix, the proposal review UX with baselines, Linux baselines in
   CI, owner approval of baselines, Storybook, and device checks.
6. **The payload digest is pinned in a guardrail test**, so changing the owner's decision input
   needs a separately reviewed guardrail change.

### What was chosen over what

The workbook recorded the alternatives for each decision. The consequential ones:

- **System fonts over a bundled face.** No download, OS text scaling applies, no licence to
  manage. Rejected: a bundled brand face, deferred until a brand project exists.
- **DTCG JSON over hand-written CSS variables or a token build tool.** A standard format, a
  small in-repo generator, and a drift test. Rejected: a token platform dependency.
- **Two tiers over three.** Component tokens only when two themes need them. Rejected: a
  component tier up front, which multiplies names without a second consumer.
- **Closed variants over open styling props.** Rejected: `className` on primitives, which lets
  each screen fork the system.
- **Tonal elevation over shadows.** Shadows only on overlays. Rejected: shadowed cards.
- **Charts deferred.** v1 shows summaries, aligned tables, and text deltas. Rejected for v1:
  a chart library and its bundle cost.
- **Storybook was selected, approved, and implemented.** On 2026-09-17 the owner approved the
  reviewed dependency change and the separate esbuild build-permission guardrail change; it
  was then installed at exact versions, with esbuild's postinstall as the only allowed build
  script. The `/lab` routes this ADR originally kept alongside it were removed the same day:
  Storybook is the only lab, and the reference screens are stories
  ([0010](0010-storybook-is-the-only-design-system-lab.md)).
- **Automated accessibility testing as the routine baseline** was selected over manual passes
  per PR. It does not waive R-007's manual checks before a conformance claim.

## Consequences

**Good.** UI work has a single, tested vocabulary. Contrast, target sizes, focus, reflow, and
theme flash are checked on every `pnpm verify`. Visual drift is checked on both platforms the
project builds on: darwin baselines for local runs and Linux baselines for CI, each generated
only after every target rendered identically twice in every project. Storybook was reviewed as
a dependency change and is the only lab, so there is one place where a component's states are
seen and checked.

**Bad.** Two baseline sets must be kept in step: a UI change that is only rebaselined on darwin
fails in CI, and rebaselining Linux needs the pinned container, which most contributors will
not run casually. Per-platform baselines are the price of system fonts (decision 1). The
guardrail commit that added `test:visual` also fails that gate on its own, because the visual
specs arrive in the product commits after it; the two phases must merge together or in order.
The reference screens use fixtures, so the system has not yet met a real workout.

**Update (2026-09-17, after implementation).** Linux baselines exist and are committed: 270
screenshots and 12 accessibility-tree snapshots per platform, identical file sets, the
accessibility snapshots byte-identical across platforms. `CI=1 pnpm verify` passed all 18 gates
inside `mcr.microsoft.com/playwright:v1.63.0-noble` (linux/amd64), and
`.github/workflows/verify.yml` runs in that image pinned by digest, with a guardrail test tying
the pin to the catalogued `@playwright/test` version. Two determinism defects were found by the
repeatability proof under load and fixed at the root: Chromium's per-paint choice of LCD
subpixel antialiasing (now `--disable-lcd-text`) and a reduced-motion reset that left stale
theme colours for one frame. This does not close gate G-10: no GitHub Actions run has happened
(no remote, G-1), and the owner has not yet approved the exact committed baseline set.

**Accepted cost.** Some defaults describe feature behaviour (wake lock, install prompt, sync
back-off). They bind the features that build them rather than being implemented speculatively.
