## ADDED Requirements

### Requirement: Sync indicator visibility
The sync indicator (`feedback.sync-indicator.icon-label`) SHALL show "On device", "Syncing" or
"Needs attention" on every screen that shows a workout read from the device. While the workout
is loading, when there is no session, or after a failed read, the indicator MUST be absent,
because nothing has been read and no persistence is claimed.

#### Scenario: A workout has been read
- **WHEN** a workout screen shows a session read from the device
- **THEN** the sync indicator is visible with the label for the current state

#### Scenario: Nothing has been read
- **WHEN** the workout screen is loading, has no session, or the read failed
- **THEN** no sync indicator is shown
- **AND** a failed read is reported by its own error message, not by "Needs attention"
