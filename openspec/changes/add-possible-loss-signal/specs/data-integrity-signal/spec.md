## Purpose

Defines how the system detects that an accepted workout mutation has gone missing from the stored
facts, the closed telemetry value that reports it, and the notification and migration-workflow
behaviour that follow. It reports; it never repairs, replays or discards.

## ADDED Requirements

### Requirement: Accepted workout mutations are checked against stored facts
The system SHALL run an integrity check that compares every idempotency-ledger entry whose stored
payload is a workout mutation with the entity that mutation must have produced, and MUST report
whether any entry has no such entity. The expected entity is: for `start_session`, the session;
for `record_set`, the set; for `complete_session`, the session in the completed state; for
`edit_set`, `delete_set` and `restore_set`, the set, where a tombstoned set counts as present.

#### Scenario: Every accepted mutation has its entity
- **WHEN** the check runs against a database in which each ledger entry has its session or set
- **THEN** it reports no missing entry

#### Scenario: An accepted set whose row is gone
- **WHEN** a `record_set` mutation was accepted and its `recorded_sets` row is later removed
- **THEN** the check reports at least one missing entry

#### Scenario: A completed session that is no longer completed
- **WHEN** a `complete_session` mutation was accepted and the session row exists with status
  `active`
- **THEN** the check reports at least one missing entry

#### Scenario: A deleted set is present
- **WHEN** a set was recorded and then deleted by an accepted `delete_set`, leaving a tombstoned row
- **THEN** the check reports no missing entry

#### Scenario: An idempotent replay is not a loss
- **WHEN** the same mutation is delivered twice with the same key and payload
- **THEN** one entity exists, the check reports no missing entry, and nothing is signalled for the
  replay

#### Scenario: A refused key reuse is not a loss
- **WHEN** a key is presented with a different payload from the one it first accepted, and is
  refused
- **THEN** the check reports no missing entry and records no integrity outcome for the refusal

#### Scenario: An entry with no stored payload
- **WHEN** a ledger entry has no stored payload
- **THEN** the check neither counts it as missing nor fails

#### Scenario: A removed user
- **WHEN** a user is removed and their ledger entries and rows go with them
- **THEN** the check reports no missing entry for that user

#### Scenario: The comparison reads one snapshot
- **WHEN** a mutation is being accepted at the moment the check runs
- **THEN** the check never reports that in-flight mutation as missing

### Requirement: The check is read-only and returns a count only
The integrity check SHALL NOT change, replay, re-queue, repair or delete any stored fact, ledger
entry or outbox entry, and MUST return no more than a count to its caller. Detecting a missing
mutation MUST NOT cause any queued workout mutation to be discarded (ADR-0003).

#### Scenario: Running the check changes nothing
- **WHEN** the check runs, including when it finds a missing entry
- **THEN** the row counts and contents of every table are identical before and after

#### Scenario: The result carries no identifiers
- **WHEN** the check finds missing entries
- **THEN** the value returned to the runner is a count, with no key, identifier, payload or
  measurement

#### Scenario: A queued mutation survives a failing check
- **WHEN** the check reports a missing entry while a device holds queued mutations
- **THEN** every queued mutation is still present and still delivers as before

#### Scenario: The check role can do nothing else
- **WHEN** the role the runner uses attempts to call a boundary function or write to any table
- **THEN** the database refuses

### Requirement: A closed integrity outcome
The system SHALL report each completed check as one `integrity.check` event carrying exactly one
`integrity.outcome` whose value is `ok`, `mutation_missing` or `check_failed`. `ok` MUST be reported
only when the check completed and found no missing entry. A check that cannot complete after three
attempts MUST be reported as `check_failed`, never as `ok`.

#### Scenario: A clean check
- **WHEN** the check completes with a count of zero
- **THEN** one `integrity.check` is recorded with `integrity.outcome` of `ok`

#### Scenario: A check that finds a loss
- **WHEN** the check completes with a count above zero
- **THEN** one `integrity.check` is recorded with `integrity.outcome` of `mutation_missing`

#### Scenario: The database is unreachable
- **WHEN** the check cannot reach the database on any of three attempts
- **THEN** one `integrity.check` is recorded with `integrity.outcome` of `check_failed`, and none
  with `ok`

#### Scenario: One dropped connection does not page
- **WHEN** the first attempt fails and the second completes with a count of zero
- **THEN** the recorded outcome is `ok`

#### Scenario: A value outside the domain is dropped
- **WHEN** an event carries `integrity.outcome` with any value other than the three declared
- **THEN** the attribute is dropped, because an allowlisted name does not license an undeclared
  value

#### Scenario: An undeclared event name is dropped
- **WHEN** application code records an event named for a root cause, such as one naming a migration
- **THEN** the event is dropped entirely

### Requirement: The signal carries no workout content
The `integrity.check` event SHALL carry no attribute other than `integrity.outcome` and the
resource attributes the exporter sets, and MUST NOT carry a count, key, identifier, payload,
exercise name or rationale. Exported metrics SHALL have `integrity.outcome` as their only label.

#### Scenario: The canary sentinel
- **WHEN** a missing set's exercise name and notes are a sentinel string and the check reports it
- **THEN** the sentinel appears in no exported event, metric label, resource attribute, header or
  request body

#### Scenario: Other attributes are not labels
- **WHEN** an `integrity.check` event also carries `synthetic` and `duration.ms`
- **THEN** neither appears as a label on the exported series, and the series count for the event
  does not exceed three

### Requirement: The check runs on a schedule and after every migration run
The system SHALL complete an integrity check at least once every 6 hours in each environment that
holds data, and SHALL run one after every run of the migration workflow against that environment,
whether the migrate job succeeded or failed.

#### Scenario: Scheduled check
- **WHEN** any 6-hour window passes in an environment that holds data
- **THEN** at least one `integrity.check` was recorded within it

#### Scenario: A migration that succeeds and removes data
- **WHEN** a migration completes and a ledger entry's row no longer exists
- **THEN** the post-migration check fails the workflow job and writes the outcome to the job
  summary

#### Scenario: A migration that fails part-way
- **WHEN** the migrate job fails
- **THEN** the integrity check still runs afterwards, and its outcome is written to the job summary

#### Scenario: A migration that fails cleanly
- **WHEN** the migrate job fails and no ledger entry is missing
- **THEN** the job is still reported as failed for the migration, and the check reports no missing
  entry

### Requirement: Possible data loss notifies both paths immediately
Once the notification route exists, an `integrity.check` outcome of `mutation_missing` or
`check_failed` SHALL notify both the Telegram path and the signed metadata-only Hermes webhook, and
the absence of any `integrity.check` for 12 hours SHALL notify both paths. Neither rule MAY exclude
the synthetic user. The notification MUST carry no workout content.

#### Scenario: A missing mutation is reported
- **WHEN** a check records `mutation_missing`
- **THEN** a Telegram message and a signed webhook are both sent, and a failure of one does not
  suppress the other

#### Scenario: The check cannot run
- **WHEN** a check records `check_failed`
- **THEN** both paths are notified

#### Scenario: The runner goes silent
- **WHEN** no `integrity.check` of any outcome is recorded for 12 hours
- **THEN** both paths are notified

#### Scenario: The synthetic user loses a set
- **WHEN** the missing entry belongs to the synthetic user
- **THEN** the alert still fires

### Requirement: The signal is drilled before it counts
The possible-data-loss signal SHALL NOT be recorded as covering D-049 until a drill against a
non-production stack has produced each of `mutation_missing`, `check_failed` and the silent-check
alert, with both paths receiving each, and a principal other than the one who ran the drill has
signed it off. G-5 MUST NOT be closed on this signal alone.

#### Scenario: Drill record
- **WHEN** the drill has run
- **THEN** a runbook entry records the date, the evidence for each case, and the sign-off by
  someone other than the runner

#### Scenario: An incomplete drill
- **WHEN** any of the three cases has no recorded evidence
- **THEN** the possible-data-loss class is still reported as not covered in
  `docs/external-gates.md`
