## Why

ADR-0003 says a queued or permanently failed workout mutation must stay visible to the user.
The workout screen shows the sync state only while it has an active session to read it from.
Once a workout is finished it is no longer active, so a finished workout that has not synced
leaves the screen with no indicator at all, even when the outbox holds a failed mutation that
needs the user's attention. Commit 57c3ae0 made the indicator absent before any read, which is
correct for loading and for a failed read, but it also removed it for "no active session".

Raised on VLA-221 by the UI/UX Designer; tracked as VLA-364. This is a change to user-visible
behaviour, so it is recorded here.

Serves: ADR-0003, VLA-221, VLA-364.

## What Changes

- On the workout screen with no active session, the sync indicator is derived from the whole
  outbox: "Needs attention" if any entry has permanently failed, else "Syncing" if any is being
  delivered, else "On device" if any is queued. With an empty outbox no indicator is shown.
- Loading and a failed read still show no indicator, and a failed read is still reported by its
  own error message, not by "Needs attention".
- No new states, labels, icons or placement: the existing indicator in the existing workout bar.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `offline-sync`: adds a requirement for sync-state visibility when no session can be read. The
  `first-vertical-slice` change that introduces the capability is not archived, so this is an
  added requirement rather than a modification of a published spec.

## Impact

**Affected:** `apps/web/app/device.ts` (`readActiveSession`), `apps/web/app/workout/page.tsx`,
`apps/web/e2e/sync-states.spec.ts`. No domain, contract, storage, token or baseline change.

**Relation to PR #51** (`amend-sync-indicator-visibility`, unmerged): that change words the
design-system rule as "absent ... with no session". This change narrows that wording for the case
where the outbox is non-empty. `DESIGN_SYSTEM.md` is deliberately not edited here, to avoid
conflicting with #51 and to keep the owner-routed file out of this PR. Once both are merged,
`feedback.sync-indicator.icon-label` should read "absent while loading, after a failed read, or
with no session and nothing waiting in the outbox"; that is task 2.1.

**Owner gate:** alters user-visible behaviour, so it needs owner approval of the spec on the PR.
