## Why

QA found, while checking VLA-321 (PR #45), that the sets table cuts off its Edit button at 320 px
with 200 % text (VLA-326). The table is 338 px wide in a 288 px region, so the last column shows
about 31 of 73 px of the Edit button, nothing signals that the region scrolls, and tabbing to Edit
does not scroll it (`scrollLeft` stays 0), so the focus ring is clipped too. The page does not
scroll sideways and Edit still works, so this is within `DESIGN_SYSTEM.md` as written. It is still
a gap for a lifter using one hand at large text: the way to log a correction is half hidden.

The UI/UX Designer chose the fix on VLA-326. Options considered:

- **Tighter cell padding at large text.** Rejected. The overflow is only 50 px, but the cells
  hold about 80 px of padding in total, so it would barely fit today and fail again with a
  three-digit load, a two-digit rep count or 250 % text.
- **A scroll cue** (edge shadow or fade). Rejected as the fix. It tells the lifter the region
  scrolls, but the lifter still has to scroll a small region with a thumb to reach the one
  action in the table. It also needs script to bring a focused Edit into view.
- **Pinning the Edit column.** Rejected. It hides data instead of the action.
- **Move Edit out of the last column, by reflowing each row** when the region is narrow. Chosen.
  Nothing is cut off at any text size and nothing needs scrolling.

This changes what the user sees, so it is recorded here.

Serves: VLA-326, VLA-321, `DESIGN_SYSTEM.md` `data.set-table.aligned-table`, WCAG 1.4.10.

## What Changes

- When the sets table's region is narrower than 13 rem (208 px at 100 % text, 288 px at 150 %,
  416 px at 200 %), each body row stacks. The measure is in rem so it follows the text size: the
  same screen stacks at 200 % text and does not at 100 %.
  - Line 1: the set number at the inline-start, the Edit button at the inline-end.
  - Line 2: Load, Reps and RIR, each as a muted label followed by its value, wrapping to a third
    line if they cannot share one.
  - The column headings move out of sight but stay in the accessibility tree.
- Above 13 rem the table is unchanged: columns Set, Load, Reps, RIR, then Edit.
- Read-only tables (the summary) follow the same rule, so the table looks and behaves one way.
- The table still scrolls in its own focusable region as a safety net for content wider than
  expected. It is not the way Edit is reached.
- `DESIGN_SYSTEM.md` wording for `data.set-table.aligned-table` and the SetTable row of the
  component table.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `design-system`: adds a requirement for the sets table at narrow widths and large text. The
  `decide-design-system` change that introduces the capability is not archived, so this is
  expressed as an added requirement.

## Impact

**Affected:** `DESIGN_SYSTEM.md`, `docs/design-system/decision-matrix.md` (implementation and
proof columns only), `apps/web/ui/patterns/SetTable.tsx` and `SetTable.module.css`, e2e coverage.
No token is added: the layout uses existing spacing, type and target tokens.

**Owner gate:** a layout rule for one pattern, not a foundation in the `DESIGN_SYSTEM.md`
change-control table, so it needs an OpenSpec change but no ADR. It edits `DESIGN_SYSTEM.md`, so
CODEOWNERS routes it to the owner.

**Visual baselines:** the two baseline viewports are 375 px at 100 % text, wider than the
threshold, so none should change. If one does, it goes in a dedicated visual-change PR.

**Risks for the implementer to check:**

- Reflowing table rows with CSS can drop table semantics in some browsers. After the change the
  accessibility tree must still expose a table with column headers and row headers. If a browser
  drops them, restore them with explicit ARIA roles rather than abandoning the reflow.
- 13 rem is sized to the current content. Measure the table's natural width with the longest
  realistic row (a load such as 102.5 kg, two-digit reps) and raise the number if the
  unstacked table overflows its region anywhere above it. Record the measured values in the PR.
