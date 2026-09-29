> A task is checked only when a gate proves it; the evidence is named beside it. Everything
> unchecked is not implemented.
>
> Tasks marked **[G-2]** need a provisioned database (gate G-2) and were not run.

## 1. Domain and contracts

- [x] 1.1 Add optional names and rest to plan, session and exercise, snapshot names into the
      session, and verify the limits (`pnpm test`: packages/domain/src/plan.test.ts,
      session.test.ts)
- [x] 1.2 Model edit, delete and restore of a set with tombstones and live numbering, and verify
      the refusals (`pnpm test`: packages/domain/src/set-edit.test.ts)
- [x] 1.3 Split the plan diff into agent input (names required) and stored (names optional), and
      verify an older stored proposal still parses (`pnpm test`: packages/contracts,
      packages/adapters-supabase/src/repositories.test.ts)

## 2. Application and outbox

- [x] 2.1 Add the `edit_set`, `delete_set` and `restore_set` mutations and use cases, and verify
      each against the in-memory ports and the store contract
      (`pnpm test:integration`: log-workout.integration.test.ts,
      local-workout-store-cases.ts)
- [x] 2.2 Carry the tombstone state through export, archive and CSV, and verify
      (`pnpm test:integration`: archive.integration.test.ts)

## 3. Server boundary

- [x] 3.1 Add the additive migration and the function changes, and verify the migration set
      (`node scripts/validate-migrations.mjs`) and the scenarios on a scratch Postgres 18
- [x] 3.2 Add ADR-0012 invariants I-26 to I-29 and provider tests for each **[G-2]**
      (written; not run, `pnpm test:provider` needs a development database)

## 4. Interface

- [x] 4.1 Start the rest timer from the plan's rest, with the 90 second fallback (`playwright test`: plan-names-and-set-edits.spec.ts, plan-carried rest)
- [x] 4.2 Show names from the session snapshot with the identifier fallback, wrapped (same spec, names)
- [x] 4.3 Today with several sessions and the finished-day state (same spec, several sessions on Today)
- [x] 4.4 Edit a set in the Set Focus layout, and the Edit column on the set table (same spec, editing a recorded set)
- [x] 4.5 Delete a set with the 10 second Undo above the sticky action bar (same spec, deleting a recorded set)
- [x] 4.6 End-to-end tests for the journeys above at 375 by 667 (same spec, at 375 by 667 and 667 by 375)

## 5. Review

- [ ] 5.1 Independent reviewer verifies the classification and the diff
- [ ] 5.2 QA verifies the journeys against `docs/design-system/flows/plan-to-workout-loop.md`
