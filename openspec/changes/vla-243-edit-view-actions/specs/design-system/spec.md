## ADDED Requirements

### Requirement: Edit view actions and opening position
The set edit view SHALL hold Cancel and Save changes together in the sticky action bar on one
row, Cancel first and secondary, Save changes second and primary, with an 8 CSS pixel gap. When
the two cannot share a row, Save changes MUST stack above Cancel. No control needed to save or
leave MUST sit in the page below the fields. Delete set MUST sit on the "Editing set N" row,
away from the bar, and keep its label and its confirm and undo behaviour. The edit view MUST open
at the top of the page. Focus MUST NOT be scrolled under the bar, including when the bar is two
rows tall.

#### Scenario: One exercise on a small portrait phone
- **WHEN** the edit view is open at 375 by 667 CSS pixels with one exercise, at scroll 0
- **THEN** Cancel, Save changes and Delete set are each fully visible and hit-test as
  themselves
- **AND** automated `target-size` checks pass

#### Scenario: Narrow screen or large text
- **WHEN** the edit view is open at 320 CSS pixels wide with text at 200%
- **THEN** Save changes is above Cancel, both are fully visible, and tabbing never lands a
  control under the bar

#### Scenario: Landscape
- **WHEN** the edit view is open at 667 by 375 CSS pixels
- **THEN** Cancel and Save changes share one row in the right pane

#### Scenario: Opened from the sets table
- **WHEN** the lifter scrolls to the sets table and taps Edit on a recorded set
- **THEN** the edit view opens with the page at the top
