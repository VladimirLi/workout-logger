## Context

The plan-to-workout loop shipped with two gaps the owner closed on VLA-9: a fixed 90 second rest
regardless of what the plan wanted, and a plan that only had identifiers. Q-4 adds the first
mutation of a recorded fact that is not a correction of a completed session.

## Decisions

### Rest belongs to the exercise, and only the plan sets it

The plan carries `restSeconds` per prescribed exercise. The device reads it when it logs a set.
The session does not snapshot it: the fallback is taken when "the revision moved", which needs the
plan's live revision, and a mid-workout rest override is out of scope. 90 seconds is the fallback
and nothing labels it "default" or "prescribed".

### Names are snapshotted by the server, not claimed by the device

A session copies the plan's session name and exercise names at start (`name`, `exercise_names`).
The database derives them from the locked plan row and refuses a payload that states a different
name (I-28), exactly as it does for the revision and exercise ids (I-14). The domain's `startSession`
does the same, so the device and the server agree.

Names are optional in stored data because plans, proposals and sessions created before this change
exist and stay valid. They are required only at the agent-input boundary (`planDiffSchema`), where
rejecting a nameless replacement costs the agent one retry and prevents new nameless plans.

Length is 60 characters. The UI wraps and never truncates. The database counts characters, the
domain and contracts count UTF-16 units; the two differ only for characters outside the Basic
Multilingual Plane.

### A delete is a tombstone, and undo is a compensating mutation

Alternatives considered:

1. **Physically delete the row, and re-send the whole set on undo.** Rejected. A queued delete that
   is replayed after its undo would remove the restored set, and a delete that reaches the server
   before the record it removes (out-of-order replay) has nothing to act on. ADR-0003 forbids
   losing or reordering queued facts.
2. **Remove the delete from the outbox when the user undoes it.** Rejected. Nothing on the
   outbox port discards an entry except `acknowledge`, by design, and the delete may already be in
   flight.
3. **Tombstone plus compensating `restore_set` (chosen).** Every step is an ordinary ordered
   mutation with its own idempotency key. A replay of the delete is the same fact (I-22). The row
   keeps its sequence, so the next set's sequence still counts it (I-18), and undo restores value
   and position.

The set number a user sees is its position among live sets. The stored `sequence` counts
tombstones and never changes, so it is an ordering key and not a label. Every reader takes sets
through `liveSets`.

The 10 second undo window and "only the latest delete is undoable" are device behaviour. The
server accepts a restore for any deleted set of an active session.

### Editing changes the result and nothing else

`edit_set` replaces the measurement and stamps `editedAt`. It cannot change the exercise, the
sequence or `recordedAt`, and it cannot change the measurement profile, so a strength set stays a
strength set (`measurement_profile_changed`). The new measurement passes the same contract (I-13)
and combined-load rule (I-16) as a new set. Saving with no change writes nothing.

`editedAt` and `deletedAt` may not precede `recordedAt` (I-29), in the domain, in the function and as
a check constraint.

### Completed sessions are untouched

Edit, delete and restore apply to an active session only (I-19). A completed session's facts stay
immutable and are corrected through audited revisions. The summary and History have no edit or
delete.

### Names on Today

Today shows `Start {session name}` per unfinished session, the first primary and the rest
secondary. A session that is completed drops off; when none is left the day is done and Today
says so.

## Risks / Trade-offs

- **Required names break an agent client that omits them.** Mitigation: the error names the field,
  and stored proposals stay readable.
- **The provider suite (I-26 to I-29 against a real database) is not run by `pnpm verify`.**
  The migration was verified against a scratch Postgres 18 with a stub of Supabase's `auth`
  schema; the provider tests still need a run against a real development database.
- **Tombstones accumulate.** A session is short-lived and deletes are rare, so the growth is
  small; the export includes the tombstone state so nothing is hidden.

## Migration Plan

One additive migration. No backfill: null names use the fallback. Rollback is dropping the new
columns after reverting the function, which loses only edit and delete history.

## Open Questions

- The server has no path from an accepted proposal to `plans.name`. Applying a plan diff on the
  server is a separate change.
