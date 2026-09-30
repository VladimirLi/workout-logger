## ADDED Requirements

### Requirement: Finishing a workout asks for confirmation
The interface SHALL ask the user to confirm before it finishes a workout, and SHALL show how many
sets are recorded. Only the confirming action MUST finish the workout. Choosing to keep going MUST
leave the workout active and unchanged. Finish MUST NOT be offered while a set is being edited.

#### Scenario: Confirming
- **WHEN** the user chooses Finish workout and confirms
- **THEN** the workout is finished and the summary is shown

#### Scenario: Keeping going
- **WHEN** the user chooses Finish workout and then Keep going
- **THEN** the workout is still active and no set has changed

#### Scenario: Finish while editing a set
- **WHEN** a recorded set is open for editing
- **THEN** Finish workout is not offered

### Requirement: A set can be logged with no prescribed target
When the workout has no target for an exercise, the user SHALL still be able to log a set. The
Load and Reps controls SHALL start empty and no Target SHALL be shown. The interface MUST NOT show
or pre-fill a number the plan did not prescribe.

#### Scenario: The plan changed after the workout started
- **WHEN** the plan revision has moved since the session started and the user chooses to log a set anyway
- **THEN** the controls start empty, no target or rest from the later revision is shown, and the set is recorded

### Requirement: Load is optional in a prescription
When a prescription has reps and no load, the Target SHALL show the reps only and the Load control
SHALL start empty. The interface MUST NOT record or show a load of 0 that nobody prescribed.

#### Scenario: A bodyweight prescription
- **WHEN** the user opens an exercise prescribed as 8 reps with no load
- **THEN** the Target reads "8 reps", the Load control is empty, and no kilogram value is shown

### Requirement: A started workout keeps how each exercise is recorded
A session SHALL keep, from when it starts, which of its exercises are recorded one side at a time.
The logging controls MUST read that stored value and MUST NOT read it from the current plan. For a
session stored without it, an exercise SHALL be one-sided only if a set already recorded for that
exercise is one-sided, and otherwise two-sided.

#### Scenario: The plan makes a one-sided exercise two-sided
- **WHEN** a workout starts with a one-sided exercise and the plan then revises it to two-sided
- **THEN** the workout still records that exercise one side at a time

#### Scenario: The plan makes a two-sided exercise one-sided
- **WHEN** a workout starts with a two-sided exercise and the plan then revises it to one-sided
- **THEN** the workout still records that exercise as one set per row, with no side chosen

#### Scenario: The plan removes the exercise
- **WHEN** the plan revision no longer contains an exercise of a started workout
- **THEN** the workout still records that exercise the way it started

#### Scenario: A session stored without the profile
- **WHEN** a stored session has no exercise profile and a one-sided set was already recorded for an exercise
- **THEN** that exercise is recorded one side at a time

### Requirement: A failed read after a recorded set does not lose or repeat it
When a set is saved but the screen cannot read the workout back, the workout SHALL stay on screen
with a message that it may not show the latest sets, and a Retry. Retry MUST only read. It MUST
NOT save a set again. Once a read succeeds the message SHALL go away.

#### Scenario: The write succeeds and the read fails
- **WHEN** a set is saved and the read that follows fails
- **THEN** the workout stays on screen, the message and Retry are shown, and the set is recorded once

#### Scenario: Retry
- **WHEN** the user chooses Retry and the read succeeds
- **THEN** the message goes away and the set is shown exactly once
