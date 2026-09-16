## Purpose

Defines the single active workout plan, its scheduled sessions, and the monotonic revision
that makes agent proposals checkable for staleness.

## ADDED Requirements

### Requirement: Exactly one active plan
The system SHALL maintain at most one active plan per user, containing scheduled workout
sessions. The first slice MUST NOT support multi-week periodization or encoded progression
rules.

#### Scenario: Activating a plan supersedes the previous one
- **WHEN** a new plan is activated while another plan is active
- **THEN** the previous plan is no longer active and its history is retained

#### Scenario: No progression rules are encoded
- **WHEN** a plan is inspected
- **THEN** it contains scheduled sessions and prescriptions, and no progression rule

### Requirement: Monotonic plan revision
The active plan SHALL carry a revision that increases on every change to the plan or its
scheduled sessions. The revision MUST be readable by an authenticated agent.

#### Scenario: Editing a prescription advances the revision
- **WHEN** an exercise prescription in the active plan is changed
- **THEN** the plan revision is greater than it was before the change

#### Scenario: Reading a session does not advance the revision
- **WHEN** the plan is read
- **THEN** the revision is unchanged

#### Scenario: The revision is exposed to agents
- **WHEN** an authenticated agent reads the active plan revision
- **THEN** it receives the current revision value

### Requirement: Scheduled sessions carry prescriptions
A scheduled session SHALL list its exercises with prescribed measurements typed by
measurement profile.

#### Scenario: A prescription uses a typed quantity
- **WHEN** a scheduled session prescribes a load
- **THEN** the prescription stores the load as a quantity with a unit

#### Scenario: A cardio prescription uses the cardio profile
- **WHEN** a scheduled session prescribes treadmill work
- **THEN** the prescription uses the cardio measurement profile
