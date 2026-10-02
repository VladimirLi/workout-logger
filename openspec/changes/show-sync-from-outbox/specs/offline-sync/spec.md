## ADDED Requirements

### Requirement: Pending mutations stay visible when no session is shown
When the workout screen has no active session to show, the sync indicator SHALL reflect the
device's outbox: "Needs attention" if any queued mutation has permanently failed, otherwise
"Syncing" if any is being delivered, otherwise "On device" if any is queued. If the outbox is
empty, no indicator SHALL be shown. While loading, and after a failed read, no indicator MUST be
shown, and a failed read MUST be reported by its own message rather than as "Needs attention".

#### Scenario: A finished workout that has not synced
- **WHEN** a workout has been finished and its mutations are still queued
- **AND** the workout screen has no active session
- **THEN** the sync indicator shows "On device"

#### Scenario: A mutation has permanently failed
- **WHEN** the workout screen has no active session and a queued mutation has permanently failed
- **THEN** the sync indicator shows "Needs attention"

#### Scenario: Nothing is waiting
- **WHEN** the workout screen has no active session and the outbox is empty
- **THEN** no sync indicator is shown

#### Scenario: The read failed
- **WHEN** the device could not be read
- **THEN** no sync indicator is shown, and the error message says the screen could not be read
