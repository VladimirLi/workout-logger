> A task is checked only when a gate proves it; the evidence is named beside it. Everything
> unchecked is not implemented or was not run.

## 1. Domain, contracts and application

- [x] 1.1 Snapshot the one-sided exercises into the session when it starts
      (`vitest --project domain`: packages/domain/src/session.test.ts)
- [x] 1.2 Carry the optional profile through the archive schema, export and restore (types
      checked with `tsc --build`; no archive round-trip test was added in this change)

## 2. Interface

- [x] 2.1 Read the profile from the session, with the recorded-set fallback, never from the plan
      (`playwright test`: apps/web/e2e/workout-journey.spec.ts, D-16 cases)
- [x] 2.2 Log with no target, and show reps only when the prescription has no load (same spec,
      the D-16 no-prescription case and the no-load case)
- [x] 2.3 Keep the workout on screen on a read failure after a write, with a read-only Retry
      (same spec, "read back")
- [x] 2.4 Confirm before finishing (same spec, D-13)

## 3. Review

- [ ] 3.1 Owner approves this change (draft, not approved)
- [ ] 3.2 Independent reviewer verifies the classification and the diff
- [ ] 3.3 QA verifies the journeys against `docs/design-system/flows/plan-to-workout-loop.md`
- [ ] 3.4 Confirm no release has shipped, or add a server copy of the profile (see Impact)
