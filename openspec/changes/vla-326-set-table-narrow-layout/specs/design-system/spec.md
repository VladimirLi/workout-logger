## ADDED Requirements

### Requirement: Sets table at narrow widths and large text
The sets table (`data.set-table.aligned-table`) SHALL keep real table markup. When the table's
region is narrower than 15 rem, each body row MUST stack: the set number at the inline-start and
the Edit button, where there is one, at the inline-end on the first line; Load, Reps and RIR on
the following line, each as a muted label followed by its value, wrapping if they cannot share a
line. The Edit button MUST keep its 44 CSS pixel target and its accessible name. The column
headings MUST stay available to assistive technology. When the region is 15 rem or wider the
table MUST keep its columns Set, Load, Reps, RIR and, where there is one, Edit. At 320 CSS pixels
with 200 % text the Edit button MUST be fully visible without scrolling, and the page MUST NOT
scroll sideways. The table MAY still scroll in its own keyboard-focusable region for content wider
than expected, but the lifter MUST NOT need to scroll it to reach Edit at 200 % text.

#### Scenario: Large text on a phone
- **WHEN** the sets table with a recorded set is rendered at 320 by 640 CSS pixels with 200 %
  text
- **THEN** each row shows its set number and a fully visible Edit button on one line, with Load,
  Reps and RIR, each labelled, below it
- **AND** the table's region does not scroll sideways
- **AND** the page does not scroll sideways

#### Scenario: Ordinary text on a phone
- **WHEN** the sets table is rendered at 375 by 667 CSS pixels with 100 % text
- **THEN** it shows the columns Set, Load, Reps, RIR and Edit in one row per set

#### Scenario: Keyboard
- **WHEN** the lifter tabs from the table's region to a row's Edit button at 200 % text
- **THEN** the focus ring is fully visible and Enter opens the edit view for that set

#### Scenario: Assistive technology
- **WHEN** the table is stacked
- **THEN** it is still exposed as a table with column headers Set, Load, Reps and RIR and the
  set number as the row header
- **AND** a missing value is still read as "not recorded"

#### Scenario: Read-only table
- **WHEN** a sets table without Edit (the summary) is narrower than 15 rem
- **THEN** its rows stack the same way, with no Edit button
