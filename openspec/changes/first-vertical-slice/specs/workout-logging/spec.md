## Purpose

Defines how the user follows a scheduled session and records what actually happened, on a
phone, mid-set, without losing anything.

## ADDED Requirements

### Requirement: Separately addressable journey states
The system SHALL provide separately addressable plan, active-workout, and
completed-summary states. Refresh, navigation, application suspension, and process
termination MUST NOT lose an active session.

#### Scenario: Refresh during an active session
- **WHEN** the user refreshes the page while a session is in progress
- **THEN** the active session is restored with every result already recorded

#### Scenario: Process termination during an active session
- **WHEN** the browser process is terminated and reopened while a session is in progress
- **THEN** the active session is restored with every result already recorded

#### Scenario: Each state has its own address
- **WHEN** the user is viewing the active workout
- **THEN** the location identifies the active workout, and can be reopened directly

### Requirement: One active session per user device
The system SHALL permit at most one active session per user device. Starting a second
session MUST offer resume or discard rather than silently starting a new one.

#### Scenario: Starting a second session
- **WHEN** the user starts a session while another is active
- **THEN** the system offers to resume the existing session or discard it

#### Scenario: Discarding requires confirmation
- **WHEN** the user chooses to discard an active session
- **THEN** the system confirms before discarding, because discarding loses recorded results

### Requirement: One primary action for an unchanged prescribed set
Accepting a prescribed set with no modification SHALL require one primary action.

#### Scenario: Logging a set as prescribed
- **WHEN** the user performs a set exactly as prescribed
- **THEN** one primary action records it

#### Scenario: Modifying before logging
- **WHEN** the user changes the load or repetitions before logging
- **THEN** the recorded result reflects the modified values, not the prescription

### Requirement: In-workout surface fits a phone
On a 375 by 667 CSS-pixel viewport, the current exercise, the current target versus actual
result, the sync state, and the primary log action SHALL be usable without horizontal
scrolling.

#### Scenario: All four elements visible at phone width
- **WHEN** the active workout is rendered at 375 by 667 CSS pixels
- **THEN** the current exercise, target versus actual, sync state, and primary log action are
  all reachable without horizontal scrolling

### Requirement: Rest timers derive elapsed time from timestamps
Rest timers SHALL compute elapsed time from timestamps rather than from interval
accumulation, so background suspension does not introduce drift.

#### Scenario: Backgrounding during rest
- **WHEN** the application is suspended for 90 seconds during a rest period and resumed
- **THEN** the displayed elapsed rest time reflects the real elapsed wall-clock time

### Requirement: Completed session facts are immutable
Once a completed session is synchronized, its facts SHALL be immutable. A correction MUST
create an audited revision rather than rewriting the original.

#### Scenario: Correcting a synchronized result
- **WHEN** the user corrects a load on a synchronized completed session
- **THEN** a new audited revision records the correction and the original value remains
  retrievable

#### Scenario: The correction records who and when
- **WHEN** a correction revision is created
- **THEN** it records the actor and the time of the correction

### Requirement: Recorded results use typed measurement profiles
Every recorded exercise result SHALL use a discriminated measurement profile with typed
quantities, and unilateral results MUST store side and load semantics explicitly.

#### Scenario: Recording a unilateral set
- **WHEN** the user records a unilateral exercise result
- **THEN** the stored record carries the side and the load semantics explicitly

### Requirement: Unilateral entry records each side separately
Each side of a unilateral exercise SHALL be recorded as its own result. Load SHALL default to
per-side semantics. Combined-load semantics SHALL be offered and accepted only for an exercise
the plan explicitly configures to permit them.

Decided by the owner on 2026-09-18. A left-right pair recorded as one result cannot express the
difference between the sides, which is the reason for measuring a unilateral exercise at all;
and a load that silently means "in total" on one exercise and "each hand" on another is the
ambiguity ADR-0004 exists to remove.

#### Scenario: Recording the two sides of one exercise
- **WHEN** the user records a left set and a right set of the same exercise
- **THEN** each is a separate result carrying its own side

#### Scenario: The default load semantics
- **WHEN** the user records a unilateral result without choosing load semantics
- **THEN** the result is stored as per-side

#### Scenario: Combined load on an exercise that does not permit it
- **WHEN** a unilateral result claims combined-load semantics for an exercise the plan does not
  configure to permit them
- **THEN** the result is refused rather than stored

#### Scenario: Combined load on an exercise that permits it
- **WHEN** the plan configures an exercise to permit combined load and the user chooses it
- **THEN** the result is stored with combined-load semantics recorded explicitly

#### Scenario: Recording strength exertion
- **WHEN** the user records exertion for a strength set
- **THEN** RIR is stored as entered and the displayed RPE is derived and not editable
