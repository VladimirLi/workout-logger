## Purpose

Defines how workout quantities and exercise results are represented so that a record stored
today remains unambiguous years later.

## ADDED Requirements

### Requirement: Typed quantities with canonical units
Every stored quantity SHALL carry an explicit unit. The system MUST NOT represent a
measurement as a bare number. Canonical storage units are kilograms, metres, seconds,
kilocalories, watts, revolutions or strokes per minute, and beats per minute.

#### Scenario: A quantity carries its unit
- **WHEN** a load of 42.5 kilograms is constructed
- **THEN** the value carries both the magnitude 42.5 and the unit `kg`

#### Scenario: Zero is a valid load
- **WHEN** a load of zero kilograms is constructed
- **THEN** it is accepted, because bodyweight work is a real load of zero added mass

#### Scenario: A non-finite value is refused
- **WHEN** a quantity is constructed from NaN, positive infinity, or negative infinity
- **THEN** the construction fails with a not-finite error

#### Scenario: A negative quantity is refused
- **WHEN** a distance of minus one metre is constructed
- **THEN** the construction fails with a negative-value error

#### Scenario: Per-unit bounds catch unit mistakes
- **WHEN** a load above the kilogram bound is constructed
- **THEN** the construction fails and reports the bound that was exceeded

### Requirement: A quantity field accepts only its own dimension
Each measurement field SHALL accept only the unit of its own dimension. A shared,
dimension-agnostic quantity type MUST NOT be used, because it permits a load expressed in
seconds and a duration expressed in kilograms.

#### Scenario: A load in a non-mass unit
- **WHEN** a strength measurement arrives with a load whose unit is seconds, metres, watts,
  or beats per minute
- **THEN** the measurement is rejected

#### Scenario: A duration in a non-time unit
- **WHEN** a cardio measurement arrives with a duration whose unit is kilograms
- **THEN** the measurement is rejected

#### Scenario: Wire bounds match domain bounds
- **WHEN** a measurement arrives with a quantity above the bound its dimension allows
- **THEN** the measurement is rejected at the boundary, rather than being accepted and then
  refused by the domain

### Requirement: Derived RPE must follow from the entered RIR
A measurement carrying strength exertion SHALL be rejected unless its RPE equals the value
derived from its RIR. The boundary MUST NOT accept a combination the domain cannot produce.

#### Scenario: An RPE that does not follow from the RIR
- **WHEN** a measurement arrives claiming an RIR of 2 with an RPE of 1
- **THEN** the measurement is rejected

#### Scenario: A consistent pair is accepted
- **WHEN** a measurement arrives claiming an RIR of 2 with an RPE of 8
- **THEN** the measurement is accepted

#### Scenario: The floor is respected at the boundary
- **WHEN** a measurement arrives claiming an RIR of 10 with an RPE of 1
- **THEN** the measurement is accepted, because the 1-10 scale bottoms out at 1

#### Scenario: A quarter-step RIR at the boundary
- **WHEN** a measurement arrives with an RIR that is not a whole or half step
- **THEN** the measurement is rejected, matching the domain

### Requirement: Profile-specific fields stay on their profile
A measurement SHALL reject a field that belongs to a different profile.

#### Scenario: An incline on a strength measurement
- **WHEN** a strength measurement carries an incline
- **THEN** the measurement is rejected

#### Scenario: Repetitions on a cardio measurement
- **WHEN** a cardio measurement carries repetitions
- **THEN** the measurement is rejected

### Requirement: Display conversion never overwrites canonical storage
The system SHALL store canonical units and convert only for display. Default display units
are kilograms, kilometres, and minutes per kilometre.

#### Scenario: Canonical storage is preserved
- **WHEN** a distance is stored and later displayed in kilometres
- **THEN** the stored value remains in metres

### Requirement: Discriminated measurement profiles
The system SHALL model exercise results as discriminated, schema-versioned profiles rather
than one nullable record. The first slice supports exactly `strength`,
`unilateral_strength`, and `cardio`.

#### Scenario: The supported profile set
- **WHEN** the supported measurement profiles are inspected
- **THEN** they are exactly strength, unilateral strength, and cardio

#### Scenario: Every measurement carries its schema version
- **WHEN** any measurement is constructed
- **THEN** it carries the current measurement schema version

#### Scenario: Repetitions must be a positive integer
- **WHEN** a strength measurement is constructed with zero, negative, or fractional
  repetitions
- **THEN** the construction fails

#### Scenario: An unknown field is rejected at the boundary
- **WHEN** a measurement payload carrying an undeclared field arrives over the wire
- **THEN** the contract rejects the payload rather than silently dropping the field

#### Scenario: Adding a profile is a compile-time obligation
- **WHEN** a new measurement profile is added to the discriminated union
- **THEN** every exhaustive branch over profiles fails to compile until it is handled

### Requirement: Explicit unilateral side and load semantics
A unilateral measurement SHALL store side and load semantics explicitly. Side is one of
left, right, both, or alternating. Load semantics is per-side or total, and defaults to
per-side. Left and right observations MUST remain distinct in storage.

#### Scenario: Load semantics default to per side
- **WHEN** a unilateral measurement is constructed without specifying load semantics
- **THEN** the stored record has per-side semantics

#### Scenario: Load semantics are always stored, never implied
- **WHEN** a unilateral measurement takes the default semantics
- **THEN** the record still carries the semantics field explicitly

#### Scenario: An explicit total override is honoured
- **WHEN** a unilateral measurement specifies total load semantics
- **THEN** the stored record has total semantics

#### Scenario: Left and right are not averaged
- **WHEN** a left-side result and a right-side result differ in repetitions and load
- **THEN** both are stored as separate records retaining their own values

#### Scenario: Side and semantics are required at the boundary
- **WHEN** a unilateral measurement payload omits side or load semantics
- **THEN** the contract rejects the payload

### Requirement: RIR is authoritative and RPE is derived
For strength sets, reps in reserve SHALL be the authoritative user-entered exertion value,
and the 1-10 RPE MUST be derived and read-only. Half-step RIR precision is permitted.
Session-level exertion, if captured, MUST be distinct and MUST NOT be computed by averaging
set values.

#### Scenario: RPE is derived from RIR
- **WHEN** a strength exertion is constructed from an RIR of 2
- **THEN** the derived RPE is 8, and it is tagged as derived rather than entered

#### Scenario: Half steps are accepted
- **WHEN** a strength exertion is constructed from an RIR of 2.5
- **THEN** it is accepted and the derived RPE is 7.5

#### Scenario: A quarter step is refused
- **WHEN** a strength exertion is constructed from an RIR of 2.25
- **THEN** the construction fails with a not-half-step error

#### Scenario: Derived RPE floors at 1
- **WHEN** a strength exertion is constructed from an RIR of 10
- **THEN** the derived RPE is 1, because the 1-10 scale bottoms out while RIR keeps counting

### Requirement: Cardio exertion is a separately tagged scale
Cardio exertion SHALL use a Borg 6-20 rating tagged distinctly from strength exertion, and
MUST NOT share an untyped field with it.

#### Scenario: The Borg range is enforced
- **WHEN** a cardio exertion is constructed with a value below 6 or above 20
- **THEN** the construction fails and reports the permitted range

#### Scenario: A 1-10 RPE value is refused as Borg
- **WHEN** a cardio exertion is constructed with the value 5
- **THEN** the construction fails, because 5 is a valid RPE but not a valid Borg rating

#### Scenario: A Borg value cannot occupy a strength exertion field
- **WHEN** a strength measurement payload carries a cardio exertion object
- **THEN** the contract rejects the payload

### Requirement: New profiles arrive through versioned code changes
The system SHALL introduce new measurement profiles through ordinary versioned code and
schema changes with validation, migrations, UI support, and tests. The first slice MUST NOT
provide plugins or user-defined schemas.

#### Scenario: No runtime schema extension point exists
- **WHEN** the measurement module's public surface is inspected
- **THEN** it exposes no plugin registration or user-defined schema mechanism
