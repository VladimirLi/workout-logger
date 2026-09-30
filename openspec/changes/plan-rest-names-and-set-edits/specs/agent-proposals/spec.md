## ADDED Requirements

### Requirement: A new proposal names what it plans
A proposal that replaces the plan SHALL carry a name for the plan and for every session and
exercise in it, and MAY carry a rest per exercise. A proposal missing a name MUST be refused with
an error that names the field. A proposal stored before names existed SHALL remain readable and
decidable.

#### Scenario: A replacement with names and rest
- **WHEN** an agent proposes a plan whose sessions and exercises are named and carry rest
- **THEN** the proposal is created and shows those names to the user

#### Scenario: A replacement without names
- **WHEN** an agent proposes a plan with a session that has no name
- **THEN** the proposal is refused and the error names the missing field

#### Scenario: An older stored proposal
- **WHEN** the user opens a pending proposal created before names existed
- **THEN** it is shown and can be accepted or rejected
