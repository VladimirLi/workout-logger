## ADDED Requirements

### Requirement: Rest starts at the plan's rest for the exercise just logged
When the user logs a set, the rest timer SHALL start at the rest the plan carries for that
exercise. It SHALL fall back to 90 seconds only when the plan carries no rest for the exercise or
the plan revision has moved since the session started. The interface MUST NOT describe the
fallback as prescribed.

#### Scenario: The plan carries rest
- **WHEN** the user logs a set for an exercise whose plan rest is 150 seconds
- **THEN** the rest timer starts at 150 seconds

#### Scenario: The plan carries no rest
- **WHEN** the user logs a set for an exercise with no plan rest
- **THEN** the rest timer starts at 90 seconds

#### Scenario: The plan moved during the session
- **WHEN** the plan revision has changed since the session started and the user logs a set
- **THEN** the rest timer starts at 90 seconds

### Requirement: Plans, sessions and exercises are shown by name
The interface SHALL show the name a plan, a scheduled session and an exercise carries. A session
SHALL keep the names the plan had when it started. Data without a name MAY fall back to a
readable form of its identifier. A name SHALL wrap and MUST NOT be truncated.

#### Scenario: A workout keeps its names
- **WHEN** the plan renames a session after a workout of that session has started
- **THEN** the workout and its summary show the name it started with

#### Scenario: A long name
- **WHEN** a name is 60 characters long
- **THEN** it is shown in full, wrapped, on the workout and the summary

#### Scenario: Data with no name
- **WHEN** a session or exercise has no name
- **THEN** a readable form of its identifier is shown

### Requirement: A recorded set can be edited while the workout is active
While a session is active, the user SHALL be able to change the result of a recorded set in place.
The exercise, the position and the recorded time MUST NOT change. The edit SHALL be seeded from
the recorded values, labelled with the set's number, and saved with one action. Saving with no
change MUST write nothing. Finishing the workout MUST NOT be offered while a set is being edited,
and the rest timer SHALL keep running.

#### Scenario: Correcting a load
- **WHEN** the user opens set 2, changes the load and saves
- **THEN** set 2 shows the new load, keeps its position, and "Set 2 updated" is confirmed

#### Scenario: Saving without a change
- **WHEN** the user opens a set and saves without changing anything
- **THEN** nothing is written and no confirmation of an update is shown

#### Scenario: The edit cannot be saved
- **WHEN** saving the edit fails
- **THEN** the user is told "That change was not saved. The set is unchanged." and the set keeps its
  recorded values

#### Scenario: Editing does not stop the rest timer
- **WHEN** the user edits a set during rest
- **THEN** the rest timer keeps running

#### Scenario: A completed workout cannot be edited
- **WHEN** the user views a completed workout's summary or History
- **THEN** no set can be edited or deleted

### Requirement: A recorded set can be deleted with a short undo
While a session is active, the user SHALL be able to delete a recorded set with immediate effect
and no confirmation dialog, and SHALL be offered Undo for 10 seconds. The remaining sets MUST
renumber to close the gap, and Undo MUST restore the set's value and position. A second delete
SHALL replace the offer, so only the latest delete is undoable. When the offer expires or the
workout is finished, the delete SHALL be final.

#### Scenario: Deleting a set
- **WHEN** the user deletes set 2 of 3
- **THEN** set 2 is gone at once, the former set 3 is now set 2, and "Set 2 deleted" is offered with
  Undo

#### Scenario: Undoing a delete
- **WHEN** the user chooses Undo within 10 seconds
- **THEN** the set returns with its value and position and "Set 2 restored" is confirmed

#### Scenario: A second delete
- **WHEN** the user deletes another set while the offer is showing
- **THEN** the offer now refers to the newer delete only

#### Scenario: The offer expires
- **WHEN** 10 seconds pass with no Undo
- **THEN** the delete is final and Undo is no longer offered

#### Scenario: Finishing the workout
- **WHEN** the user finishes the workout while an Undo is offered
- **THEN** the delete is final

#### Scenario: A delete or restore that fails
- **WHEN** a delete fails
- **THEN** the user is told "That set was not deleted." and the set remains
- **WHEN** an undo fails
- **THEN** the user is told "That set could not be restored."

### Requirement: Today lists every unfinished session and shows a finished day
Today SHALL list a `Start {session name}` action for each scheduled session of the day that is not
finished, the first as the primary action and the others as secondary. A session that is completed
SHALL no longer be listed. When no unfinished session remains for the day, Today SHALL say the
day's workout is done, that the summary is saved on the device, and offer to see history.

#### Scenario: Two sessions in a day
- **WHEN** the plan schedules two sessions today and neither is finished
- **THEN** Today shows a primary start action for the first and a secondary one for the second

#### Scenario: One is finished
- **WHEN** the user has completed one of two sessions
- **THEN** Today lists only the other

#### Scenario: All are finished
- **WHEN** every session for the day is completed
- **THEN** Today says "Today's workout is done" and offers "See your history"
