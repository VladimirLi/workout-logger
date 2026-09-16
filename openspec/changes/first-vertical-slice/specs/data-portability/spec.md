## Purpose

Defines how the user gets their data out, and how deletion works without being a trap.

## ADDED Requirements

### Requirement: One-action full JSON export
The system SHALL provide a one-action full export in JSON. The export MUST be versioned and
round-trip importable into a clean compatible instance.

#### Scenario: Exporting everything
- **WHEN** the user requests a full export
- **THEN** a single versioned JSON document containing plans, sessions, results, proposals,
  and revisions is produced

#### Scenario: Round-tripping an export
- **WHEN** a full export is imported into a clean compatible instance
- **THEN** the imported data matches the exported data

#### Scenario: The export declares its version
- **WHEN** an export is inspected
- **THEN** it declares the schema version it was written against

### Requirement: Human-readable CSV export of workout history
The system SHALL provide CSV exports of workout history readable in a spreadsheet.

#### Scenario: Exporting history as CSV
- **WHEN** the user requests a CSV export of workout history
- **THEN** each row carries the session, exercise, measurement profile, typed values with
  their units, and any exertion value with its scale

#### Scenario: Units are explicit in CSV
- **WHEN** a CSV export is inspected
- **THEN** every quantity column names its unit, because a spreadsheet has no type system

### Requirement: Recoverable deletion followed by verified hard deletion
Deletion SHALL enter a 30-day recoverable period, then proceed to verified hard deletion. The
interface MUST explain when expired backup generations stop containing the deleted data.

#### Scenario: Deleting within the recovery period
- **WHEN** the user deletes data and changes their mind within 30 days
- **THEN** the data is recoverable

#### Scenario: After the recovery period
- **WHEN** 30 days have passed since deletion
- **THEN** the data is hard-deleted and the deletion is verified

#### Scenario: Backup expiry is explained
- **WHEN** the user initiates deletion
- **THEN** the interface states when backup copies cease to contain the deleted data

### Requirement: Audit and proposal history is retained until deleted
Proposal artifacts, audit events, and revision history SHALL be retained until the user
explicitly deletes them.

#### Scenario: A rejected proposal after a year
- **WHEN** a proposal was rejected a year ago and the user has not deleted it
- **THEN** its record, diff, and rationale remain retrievable
