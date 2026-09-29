# Proposal

## Why

Reviewing the VLA-14 plan-to-workout work (VLA-43) found three behaviours that the shipped specs
do not describe, and one stored value that has no spec at all:

- Finishing a workout asks for confirmation. No requirement says so.
- A set can be logged with no prescribed target, for example when the plan changed after the
  workout started or the prescription has no load. No requirement says what the screen shows.
- Whether an exercise is recorded one side at a time was read from the *current* plan. A plan
  revised mid-workout could change the controls of a workout already started.

Each changes what the user sees or what is stored, so it needs a spec (AGENTS.md, "Does this need
an OpenSpec change?"). This change is a draft. It has not been approved.

## What Changes

- **Finish confirmation.** Finishing a workout asks "Finish this workout?" and shows how many sets
  are recorded. Only the confirming action finishes. "Keep going" leaves the workout active and
  unchanged. Finish is not offered while a set is being edited.
- **Logging with no prescribed target.** When the workout has no target for an exercise, the user
  can still log a set. The Load and Reps controls start empty and no Target line is shown. No
  number the plan did not prescribe is displayed or pre-filled.
- **Load is optional.** When a prescription has reps but no load, the Target shows the reps only
  (for example "8 reps") and the Load control starts empty. A load of 0 kg is never invented.
- **Session exercise profile.** A started session stores which of its exercises are one-sided
  (`unilateralExercises`), copied from the plan when it starts, next to the name and the exercise
  names it already snapshots. The logging controls read this stored value and never the current
  plan, so a later plan revision cannot change how a started workout is logged. A session stored
  before the field existed falls back to the profile of a set already recorded for the exercise,
  and otherwise to two-sided.
- **Read failure after a write.** When a recorded set is saved but the screen cannot read it back,
  the workout stays on screen with a message and a Retry that only re-reads. It never re-submits
  the set.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `workout-logging`: finish confirmation, logging with no prescribed target, optional load, the
  session exercise profile, and a read failure after a write.
- `data-portability`: an exported session carries the optional exercise profile and a restore
  accepts it.

Base requirements still live in the unarchived `first-vertical-slice` change, so each delta is an
ADDED requirement. Nothing removes or weakens one: completed-session immutability, one active
session per device and the never-discard rule all still hold.

## Impact

**Stored data.** One optional field, `unilateralExercises` (array of exercise identifiers), on a
session in the device's local store and in the export archive. Optional, so every stored session
and every earlier export stays valid. No migration.

**Server boundary (a known limit).** `apply_workout_mutation` snapshots a session's name and
exercise names from the locked plan and compares only the payload keys it knows. It does not
know `unilateralExercises`, ignores it, and does not store it. The value is therefore device-local
in this change. A session restored from the server or from an archive without the field uses the
fallback above. Storing it on the server is a separate change and needs a migration.

**Assumption to confirm.** The fallback matters only for sessions stored before this field. It is
assumed that no release has shipped, so those sessions exist only in development browsers. If a
release has shipped, an in-progress one-sided workout that started before the field could show
two-sided controls until its first set is recorded. The approver should confirm the assumption.

**Wire contracts.** `packages/contracts` archive schema gains the optional field.

**Packages.** domain, contracts, application, web. Dependency direction unchanged. No guardrail
file is touched.

**Classification.** Needs a change. The implementing agent's classification is not authoritative
(D-009); an independent reviewer verifies it in the child review issue.
