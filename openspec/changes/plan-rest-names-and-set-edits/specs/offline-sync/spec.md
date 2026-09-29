## ADDED Requirements

### Requirement: Editing, deleting and restoring a set are recorded mutations
Editing a set, deleting a set and restoring a deleted set SHALL each be a mutation written to the
outbox atomically with the change, with its own stable idempotency key, drained in order with the
session's other mutations. A delete MUST be recorded as a tombstone rather than a removal, and a
restore MUST be a later mutation that compensates it, so that no queued mutation is discarded or
reordered.

#### Scenario: Delete then undo while offline
- **WHEN** the user deletes a set and undoes it while offline
- **THEN** the outbox holds the delete and then the restore, in that order, and the set is present
  once both are delivered

#### Scenario: A replayed delete
- **WHEN** a delete is delivered again with the same key
- **THEN** the server returns the original result and the set is deleted once

#### Scenario: A change to a completed session
- **WHEN** a delivered edit, delete or restore names a session that is already completed
- **THEN** the server refuses it and the completed session's facts are unchanged

#### Scenario: A change that predates the set
- **WHEN** an edit or delete is stamped before the set was recorded
- **THEN** the server refuses it
