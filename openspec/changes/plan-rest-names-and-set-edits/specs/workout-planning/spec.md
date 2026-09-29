## ADDED Requirements

### Requirement: Plans, sessions and exercises carry a name
A plan, a scheduled session and a prescribed exercise SHALL each be able to carry a name of 1 to
60 characters that is not blank. A name SHALL be optional in stored data. A change to the plan's
names MUST advance the plan revision, like any other change to the plan.

#### Scenario: A named plan
- **WHEN** a plan is activated whose sessions and exercises carry names
- **THEN** those names are stored with the plan and downloaded to the device

#### Scenario: An unacceptable name
- **WHEN** a plan carries a blank name or one longer than 60 characters
- **THEN** it is refused, and nothing is stored

#### Scenario: A plan stored before names existed
- **WHEN** a plan with no names is read
- **THEN** it is valid and its identifiers are used to show it

### Requirement: An exercise carries the rest to take after it
A prescribed exercise SHALL be able to carry a rest of a whole number of seconds from 1 to 3600.
Rest SHALL be optional. A change to it MUST advance the plan revision.

#### Scenario: A prescription with rest
- **WHEN** an exercise is prescribed with 120 seconds of rest
- **THEN** the plan stores 120 seconds for that exercise

#### Scenario: An unacceptable rest
- **WHEN** an exercise carries a rest of 0, a fraction, or more than 3600 seconds
- **THEN** it is refused
