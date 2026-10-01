## Why

QA found two defects in the set edit view on VLA-14 candidate `7652a86` (VLA-243, from VLA-44).

1. At 375 x 667 with one exercise, Cancel sat in the page at y=627..671 while the pinned Save
   bar covered y=599..655. Cancel was mostly under the bar until the page scrolled, and axe
   `target-size` (WCAG 2.2 AA 2.5.8) failed with a visible area of 343 x 16.
2. In landscape with two or more exercises, opening the edit view from the sets table left the
   page 49 px scrolled, with the workout bar's Close above the top of the screen.

The UI/UX Designer decided item 1 in VLA-304: move Cancel into the sticky bar beside Save
rather than pad the page, because padding only moves the problem and then Delete set sits
under the bar instead. Vladimir approved the work on VLA-293 (2026-10-01).

This changes what the user sees and where controls are, so it is recorded here.

Serves: VLA-243, VLA-304, `DESIGN_SYSTEM.md` `layout.primary-action.sticky-bottom`.

## What Changes

- The edit view's sticky bar holds Cancel (secondary) and Save changes (primary) on one row,
  Cancel first. When they cannot share a row (320 px, 200% text) Save changes stacks above
  Cancel. Tab order stays Cancel, then Save changes.
- Delete set moves to the "Editing set N" row, beside the label, as a tertiary button. Its label,
  confirm and undo behaviour are unchanged.
- The edit view opens at the top of the page, so opening it from the sets table in landscape no
  longer leaves the page scrolled.
- When the bar holds two actions, the page's `scroll-padding-block-end` clears a two-row bar, so
  focus is never scrolled under it.
- `DESIGN_SYSTEM.md` wording for `layout.primary-action.sticky-bottom` (commit `a533b8d` from
  VLA-304, a clarification, not a new decision).

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `design-system`: adds a requirement for the edit view's action bar and opening position. The
  `decide-design-system` change that introduces the capability is not archived, so this is an
  added requirement.

## Impact

**Affected:** `apps/web/app/workout/EditSet.tsx`, `apps/web/ui/patterns/LogToRest.tsx` and
`.module.css` (`SetFocusLayout` gains a secondary-action slot), `apps/web/app/global.css`,
`apps/web/e2e/workout-journey.spec.ts`, `DESIGN_SYSTEM.md`. No stored data, MCP tool, scope or
telemetry attribute changes. Not a guardrail path change.

**Baselines:** no committed visual baseline shows the edit view (checked the darwin and linux
sets: the Set Focus reference story is the log view), so no visual-change PR is needed.

**Known gap, not fixed here:** at 320 px and 200% text the sets table is wider than the screen and
makes the page scroll sideways when a set has been recorded. The existing reflow check does not
open a recorded set. Tracked separately.
