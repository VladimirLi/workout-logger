## ADDED Requirements

### Requirement: An export carries which exercises a session records one-sided
A session in an export SHALL carry the exercise profile it was started with when it has one, and a
restore SHALL accept it and keep it. A session without it MUST remain valid, so an export made
before this field existed can still be restored.

#### Scenario: Round trip
- **WHEN** a session that has an exercise profile is exported and restored
- **THEN** the restored session has the same exercise profile

#### Scenario: An earlier export
- **WHEN** a session in an export has no exercise profile
- **THEN** it is restored without one and the fallback for a session without the profile applies
