## Purpose

Defines what operational telemetry may contain, and guarantees by construction that workout
content and agent rationale never leave the process through an exporter.

## ADDED Requirements

### Requirement: Telemetry attribute allowlist
The system SHALL export only allowlisted, low-cardinality operational attributes. Any
attribute not on the allowlist MUST be dropped before export, not redacted, hashed, or
truncated.

The allowlist is exactly: `service.name`, `service.version`, `deployment.environment`,
`http.route`, `operation.type`, `response.class`, `duration.ms`, `retry.count`,
`queue.state`, `migration.version`, `synthetic`.

#### Scenario: An unknown attribute is dropped
- **WHEN** application code records an event carrying an attribute named `exercise.name`
- **THEN** the exported event does not contain that attribute or its value
- **AND** the attribute name is reported as dropped

#### Scenario: Allowlisted operational metadata is exported
- **WHEN** application code records an event with `service.name`, `http.route`,
  `operation.type`, `response.class`, and `duration.ms`
- **THEN** all five attributes appear in the exported event unchanged

#### Scenario: An oversized value under an allowlisted name is dropped
- **WHEN** an event carries `operation.type` with a 5000-character value
- **THEN** the attribute is dropped, because an allowlisted name does not license an
  unbounded value

#### Scenario: A structured value under an allowlisted name is dropped
- **WHEN** an event carries `operation.type` whose value is an object
- **THEN** the attribute is dropped

#### Scenario: Boolean false is preserved
- **WHEN** an event carries `synthetic` with the value `false`
- **THEN** the exported event contains `synthetic: false`, because false is a value and not
  an absence

### Requirement: Closed value domain per attribute
Each allowlisted attribute SHALL have a closed value domain - an enumeration, a bounded
integer, a boolean, or a pattern that free text cannot satisfy. An allowlisted name with a
value outside its domain MUST be dropped. Naming an attribute MUST NOT by itself make a
value exportable.

#### Scenario: Free text under an allowlisted enum key
- **WHEN** an event carries `operation.type` with an exercise description
- **THEN** the attribute is dropped, because the value is not a declared operation

#### Scenario: Free text under every allowlisted key at once
- **WHEN** an event sets every allowlisted attribute to the same sentinel string
- **THEN** no allowlisted attribute survives and the exported event contains no part of the
  sentinel

#### Scenario: A string under a boolean attribute
- **WHEN** an event carries `synthetic` with the string `"true"`
- **THEN** the attribute is dropped

#### Scenario: A numeric attribute outside its bound
- **WHEN** an event carries `duration.ms` with a value larger than one day, or a fractional
  or negative value
- **THEN** the attribute is dropped

#### Scenario: A version string carrying extra content
- **WHEN** an event carries `service.version` with content appended after the patch number
- **THEN** the attribute is dropped

### Requirement: Closed event names
Event names SHALL come from a closed, reviewed set. An event whose name is not on that set
MUST be dropped in its entirety, including any attributes that would otherwise have
survived sanitising.

#### Scenario: An undeclared event name
- **WHEN** telemetry records an event named after a workout action
- **THEN** nothing is exported and the outcome reports that the event was not accepted

#### Scenario: A declared event name
- **WHEN** telemetry records an event whose name is on the declared set
- **THEN** the event is exported with its sanitised attributes

### Requirement: Route templates only
The system SHALL record `http.route` as a route template and MUST NOT record a resolved
path, a URL, a query string, or a request header.

Route templates SHALL be enumerated rather than matched by pattern, because a pattern
cannot distinguish a template from a resolved path.

#### Scenario: A resolved URL is rejected
- **WHEN** an event carries `http.url` with a full URL containing a query string
- **THEN** the attribute is dropped

#### Scenario: A resolved path under http.route is rejected
- **WHEN** an event carries `http.route` with a path containing a real identifier
- **THEN** the attribute is dropped, because that path is not a declared route template

#### Scenario: A declared route template is accepted
- **WHEN** an event carries `http.route` with a template from the declared list
- **THEN** the attribute is exported unchanged

### Requirement: Telemetry canary
A canary test SHALL push sentinel workout content through the normal instrumentation path
and assert the sentinel never reaches the exporter. The canary MUST be a required gate, and
a canary that cannot run MUST fail rather than be skipped.

#### Scenario: Sentinel content never reaches the exporter
- **WHEN** an event is recorded carrying a sentinel string in exercise name, set notes,
  agent rationale, proposal diff, user id, URL, and authorization header attributes
- **THEN** the serialized exported events do not contain the sentinel string anywhere

#### Scenario: Dropped-attribute reporting does not leak values
- **WHEN** the canary inspects the record outcome's list of dropped attributes
- **THEN** the outcome contains attribute names only, and does not contain the sentinel
  string

### Requirement: Default exporter discards
The system SHALL default to an exporter that discards every event, so that an
unconfigured deployment exports nothing.

#### Scenario: No exporter configured
- **WHEN** telemetry is constructed without an explicit exporter and an event is recorded
- **THEN** nothing is exported

### Requirement: Single telemetry entry point
Only the observability package SHALL call an OpenTelemetry SDK. Every other package MUST
use the approved allowlisting API, and this MUST be machine-enforced.

#### Scenario: Another package imports OpenTelemetry directly
- **WHEN** a module outside the observability package imports from `@opentelemetry/*`
- **THEN** the architecture gate fails with the `telemetry-through-observability` rule
