## Context

`apps/web` was a structural shell with no palette, type scale, or spacing scale, held there by
ADR-0007 until the design system was decided. The owner has now decided it: 65 selections in a
workbook whose options carried rendered previews, recommendations, and rationales, together
with 146 defaults and 22 deferrals.

## Goals / Non-Goals

**Goals:**

- Record the decision normatively and traceably, with no substitution for any selection.
- Encode it as tokens and components that make the decision the easy path and deviations
  fail a gate.
- Deterministic visual regression and automated accessibility evidence.
- Keep acceptance and validation separate, so nothing claims what has not happened.

**Non-Goals:**

- Implementing any product feature. The reference screens use fixtures.
- Deciding the proposal review UX. The first vertical slice decides it.
- Implementing charts (`data.charts-v1.defer`).
- Provisioning anything, or adding a dependency.

## Decisions

### The owner decided through a workbook, not through competing prototypes

The original plan was two or more full prototypes compared against a checklist. The workbook
did that work at a finer grain: every question had two to four rendered alternatives, a
recommendation, and a rationale, and the owner chose per question. The payload is kept
verbatim and pinned by digest, so the record is the owner's own input, not an agent summary.

**Rejected:** re-running a prototype comparison after the owner decided. It would re-open
settled questions and substitute agent judgement for the owner's.

### Acceptance and validation are different states

`Accepted` means the owner decided and the decision is encoded. It unblocks UI work built on
the system. Validation — the target user using the journeys (R-022), the manual accessibility
matrix (R-007), the proposal review UX, Linux baselines in CI, owner approval of baselines —
is tracked separately and keeps gate G-10 open. The policy test refuses a closed G-10 that
does not mention that evidence.

**Rejected:** holding `NOT DECIDED` until validation. It would block the very feature work
through which R-022 validation happens. **Rejected:** closing G-10 on acceptance. It would
assert journey use and conformance nobody has performed.

The spec's baseline coverage for proposal review therefore applies at G-10 closure, not at
acceptance: the proposal review UX is explicitly not part of this decision, so its baselines
cannot exist yet. The requirement itself is unchanged.

### The gate stays a document status, checked by a guardrail test

The status assertion in `scripts/policy-consistency.test.ts` was changed in a separate
guardrail commit before the product commits. Once the status is `Accepted` it demands the
verbatim payload, its digest in `DESIGN_SYSTEM.md`, a matrix row for every selection, no
unselected option, ADR-0008 superseding ADR-0007, and a visual gate that never writes
baselines.

### Tokens: DTCG JSON, two tiers, generated output committed

A small generator in the repo, not a token platform. Output is committed so the build needs no
extra step, and a test fails when it drifts. Only semantic tokens become custom properties.

**Rejected:** hand-written custom properties (no source of truth to check contrast against);
Style Dictionary (a dependency for a few hundred lines of work).

### Components: closed variants, CSS Modules, no library

Primitives accept no `className` or `style`; `Stack` is the layout escape hatch. Tests enforce
tokens-only CSS, logical properties, and screens importing only from `apps/web/ui`.

**Rejected:** a headless component library (dependency and licence review for what native
elements already provide: `dialog`, radios, `inputmode`).

### Icons vendored, not installed

Lucide geometry is copied unmodified with its full ISC and MIT notices, listed in a ledger a
test checks. **Rejected:** `lucide-react` — permissible under the licence policy but a
dependency change the owner's licence decision asks to avoid without review.

### Storybook is blocked, not substituted

`governance.lab.storybook` was selected. Installing it needs an esbuild build permission in
guardrail files and adds 196 packages, a material dependency change under LIC-2026-09-16. It
is recorded as blocked. `/lab` exists because `docs.source.repo-md-lab` names it; it is not
presented as a Storybook replacement.

### Visual regression: per-platform baselines, repeatability proven separately

System fonts render differently per OS, so baselines are stored per platform. `toHaveScreenshot`
passes on a first matching shot, which does not prove determinism, so a separate test renders
every page twice in fresh contexts and requires identical bytes. The large phone and 200 % text
projects are added to the owner's two viewports because R-007 requires them.

**Rejected:** a bundled test-only font. It would not remove per-platform differences and would
stop the baselines showing the accepted system-font rendering.

## Risks / Trade-offs

**CI's visual gate fails until Linux baselines exist.** Accepted and recorded rather than
skipped; fixing it is a guardrail change to run CI in the pinned Playwright container.

**A lab of fixtures can look finished.** Every lab page says it uses fixture data, and the
validation status says the journeys have not met a real workout.

**Owner selections that trade coverage for speed** (`accessibility.testing.auto-only`) are
honoured as routine CI scope without being read as waiving R-007's manual checks.

## Open Questions

- Which change decides the proposal review UX, and when does its baseline land?
- Does the owner approve the Storybook dependency change, or revise that selection?
