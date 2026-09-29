## Context

`startSession` already snapshots the session name and its exercise names from the plan so a plan
revised mid-workout cannot rename a workout that started. The one-sided profile was the exception:
the logging screen read it from the current plan. The review found this lets a later revision
change the controls, and could show a target or rest from a revision the user never started.

## Decisions

### The profile is a session snapshot

`startSession` copies the ids of the plan's `unilateral_strength` exercises into
`unilateralExercises`. The screen reads that value. It is optional in the type because sessions
stored before it existed do not have it.

Alternative rejected: keep reading the plan and ask the user. It leaves the controls dependent on
a revision the user did not start with.

### Device-local, not on the server

The server derives a session's snapshot from the locked plan and ignores payload keys it does not
know. Adding the field to the payload is safe and needs no migration, and storing it on the server
would need one. Only this device has a session it started, so the value is needed here first. A
server copy is left for a later change.

### Fallback for a session without the field

For an exercise, use the profile of a set already recorded for it, and otherwise two-sided. A
recorded set is a fact the user entered, so it cannot disagree with what was logged. Two-sided is
the safe default: one row per set, and it never records a side nobody chose.

### No invented numbers

With no prescribed target the controls start empty. With a prescription that has no load the
target is reps only and Load starts empty. Neither shows `0`, since a stored 0 kg is a claim.

### A failed read never re-submits

A write and the read that refreshes the screen are separate. If the read fails after the write
succeeded, the user has recorded the set. Retry re-runs only the read. Re-running the write would
depend on the idempotency key, and the screen does not need to lean on it.

### Finish confirms before it acts

Finishing is not undoable, since a completed session is immutable. One confirmation with a
"Keep going" choice is the smallest guard against a stray tap mid-set.
