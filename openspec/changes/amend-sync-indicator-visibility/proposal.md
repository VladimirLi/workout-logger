## Why

`DESIGN_SYSTEM.md` (`feedback.sync-indicator.icon-label`) says the sync indicator is "always
visible". The shipped workout screen (commit 57c3ae0, `apps/web/app/workout/page.tsx` and
`apps/web/ui/patterns/Bars.tsx`) omits it while loading, when there is no session, and after a
failed read. That is the right behaviour: with nothing read, "On device" would be false, and
"Needs attention" after a failed read would confuse a read error with a stuck write. ADR-0003's
three states describe stored data, and the error message already covers a failed read. The rule
overreaches; the code does not.

The UI/UX Designer proposed the wording on VLA-221 and a human accepted it
(`request_confirmation` 5c6255ac-0643-4347-8272-043618a24002, outcome `accepted`). It changes
what the user sees, so it is recorded here rather than treated as a wording fix.

Serves: ADR-0003, ADR-0008, VLA-221, VLA-220.

## What Changes

- Replaces "always visible" for `feedback.sync-indicator.icon-label` with: visible on every
  screen that shows a workout read from the device; absent while loading, with no session, or
  after a failed read.
- Updates `DESIGN_SYSTEM.md` and the matching sentence in
  `docs/design-system/flows/plan-to-workout-loop.md`. The decision matrix's "Accepted meaning"
  column keeps the owner's original wording.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `design-system`: adds a requirement for when the sync indicator is shown. The
  `decide-design-system` change is not archived, so this is an added requirement.

## Impact

**Affected:** `DESIGN_SYSTEM.md`, `docs/design-system/flows/plan-to-workout-loop.md`. No code,
token, test or baseline is touched. The shipped behaviour (PR #37) already matches. Not a
guardrail path change.

**Not decided here:** if the outbox holds queued or failed mutations and no session can be read
(for example a finished session that has not synced), ADR-0003 still requires `needs attention`
to be visible. This change does not cover that case; it is tracked separately for engineering.
