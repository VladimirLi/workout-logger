## ADDED Requirements

### Requirement: Landscape two-pane scrolling rule
On a landscape phone (`layout.landscape.two-pane`), the set screen SHALL show values on the
left and controls plus the log-set action on the right, and the action MUST stay in view at the
bottom of the right pane. At 667 x 375 CSS pixels an ordinary set MUST fit with no scrolling.
A unilateral or combined-load set MUST scroll its controls inside the right pane, above the
action and never under it. The session summary, set table and Done MUST sit below the two panes
and scroll with the page. Workout targets MUST remain at least 48 CSS pixels with 8 CSS pixel
gaps in every case.

#### Scenario: An ordinary set at 667 x 375
- **WHEN** an ordinary set is rendered at 667 by 375 CSS pixels
- **THEN** the set controls and the log-set action are visible with no vertical scrolling of
  the panes

#### Scenario: A unilateral or combined-load set at 667 x 375
- **WHEN** a unilateral or combined-load set is rendered at 667 by 375 CSS pixels
- **THEN** its controls scroll inside the right pane, and the log-set action stays in view
  below them
- **AND** no control is covered by the action

#### Scenario: Content below the panes
- **WHEN** the set screen is rendered in landscape
- **THEN** the session summary, set table and Done are below the panes and scroll with the page

#### Scenario: Targets are not shrunk to avoid scrolling
- **WHEN** any set profile is rendered at 667 by 375 CSS pixels
- **THEN** every workout control keeps its 48 CSS pixel target and 8 CSS pixel gaps
