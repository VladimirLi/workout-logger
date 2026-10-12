> A task is checked only when a gate proves it; the evidence is named beside it. Everything
> unchecked is not implemented or was not run.

## 1. Implementation

- [x] 1.1 Derive the indicator from the whole outbox when there is no active session
      (`apps/web/app/device.ts`, `apps/web/app/workout/page.tsx`)
- [x] 1.2 e2e: empty outbox shows none; queued shows "On device"; failed shows "Needs attention"
      (`apps/web/e2e/sync-states.spec.ts`)

## 2. After PR #51 merges

- [ ] 2.1 Reword `feedback.sync-indicator.icon-label` in `DESIGN_SYSTEM.md` and the flow doc to
      cover the non-empty-outbox case (docs-only PR; CODEOWNERS routes `DESIGN_SYSTEM.md`)

## 3. Gates

- [ ] 3.1 `pnpm verify` and CI green; independent review and QA verdicts on the final SHA
