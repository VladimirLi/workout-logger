# Proposal

## Why

The owner answered four open questions on the plan-to-workout loop (VLA-9) and the UI/UX spec
(`docs/design-system/flows/plan-to-workout-loop.md`, revision 2) turned them into deltas:

- **Q-1** The plan, not the app, decides how long to rest after each exercise.
- **Q-2** A plan, a session and an exercise have a name, instead of a de-slugged identifier.
- **Q-3** More than one session on a day is possible, though rare.
- **Q-4** A recorded set can be edited or deleted while the workout is still being logged.

Each changes what the user sees or what is stored, and the last changes what the server accepts,
so this is a product-behaviour change and needs a spec (AGENTS.md, "Does this need an OpenSpec
change?").

## What Changes

- **Plan-carried rest.** A prescribed exercise MAY carry `restSeconds` (integer, 1 to 3600).
  The rest timer starts at the plan's rest for the exercise just logged, and falls back to 90
  seconds only when the plan has none or the plan revision moved under the session.
- **Names.** A plan, a scheduled session and a prescribed exercise MAY carry a `name` (1 to 60
  characters, not blank). A workout session snapshots the plan's session name and its exercise
  names when it starts, so a later plan revision cannot rename a workout that already happened.
  Names are required on new agent proposals and optional in stored data. Data without a name
  keeps the readable identifier fallback.
- **Edit and delete a set.** While a session is active, a recorded set's result can be changed in
  place, and a set can be deleted with an immediate effect and a 10 second undo. The exercise, the
  position and the recorded time are not editable. Nothing applies to a completed session.
- **Several sessions in one day.** Today lists every scheduled session for the day that is not
  finished, and a day whose sessions are all finished shows a "done" state.
- **Server boundary.** `apply_workout_mutation` accepts three new kinds, `edit_set`, `delete_set`
  and `restore_set`, and snapshots names from the locked plan. Invariants I-26 to I-29 are added
  to ADR-0012's matrix.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `workout-logging`: rest from the plan, names, editing and deleting a recorded set, Today with
  several sessions and a finished day.
- `workout-planning`: names and rest on a plan, a session and an exercise.
- `offline-sync`: edit, delete and restore are recorded mutations that replay as the same fact.
- `agent-proposals`: a new proposal carries names, and may carry rest.

The base requirements still live in the unarchived `first-vertical-slice` change, so each delta
below is an ADDED requirement. Nothing in it removes or weakens a requirement there: completed
session immutability, one active session per device and the never-discard rule all still hold.

## Impact

**Stored data (migration `20260929100000_plan_names_and_set_edits.sql`, additive only).**
`plans.name`, `workout_sessions.name`, `workout_sessions.exercise_names`,
`recorded_sets.edited_at`, `recorded_sets.deleted_at`, each with a check constraint. Existing rows
stay valid with the columns null. No destructive migration.

**Wire contracts.** `planDiffSchema` requires `name` on a replacement plan and on every session
and exercise it carries (agent input). `storedPlanDiffSchema` keeps them optional so a proposal
stored before this change is still readable. This is a breaking change for an agent client that
omits names; existing stored proposals are unaffected.

**Behaviour change to flag.** `changeExercisePrescription` now keeps an exercise's
combined-load permission, name and rest when it changes the prescription.

**Server write path.** The server has no plan-diff application path yet, so `plans.name` has no
server writer in this change. Names reach a device through the plan it downloads.

**Packages.** domain, contracts, application, adapters-supabase, test-support, mcp, web.
Dependency direction unchanged. No guardrail file is touched.

**Classification.** Needs a change. The implementing agent's classification is not
authoritative (D-009); an independent reviewer verifies it in the child review issue.
