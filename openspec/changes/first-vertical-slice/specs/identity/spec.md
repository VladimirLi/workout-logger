## Purpose

Defines how the user proves who they are, and how the database refuses everyone else.

## ADDED Requirements

### Requirement: Passwordless authentication with an OTP recovery path
The system SHALL use managed passwordless authentication and MUST NOT manage passwords
itself. Email one-time-code authentication SHALL be the guaranteed recovery path. Passkeys
MAY be offered as a daily convenience.

#### Scenario: Signing in with an email code
- **WHEN** the user requests a sign-in code and submits it
- **THEN** an authenticated session is established

#### Scenario: Passkey unavailable
- **WHEN** the user's passkey is unavailable on the current device
- **THEN** the email code path remains available and sufficient to sign in

#### Scenario: No password is ever stored
- **WHEN** the authentication configuration is inspected
- **THEN** no password credential is stored or accepted

### Requirement: The device records under its own identity until an account claims it
The application SHALL be usable before any sign-in. The device SHALL generate one durable
local identity on first use, and every local workout fact SHALL be recorded under it. When an
account is used on that device for the first time, the local data recorded under the device
identity SHALL be claimed by that account, and MUST NOT be discarded, duplicated, or left
unreachable.

Decided by the owner on 2026-09-18, because authentication depends on a provisioned service
(gates G-2 and G-4) and a workout cannot wait for one: the device is already the first place a
fact is saved (ADR-0003), and that only works if the device can name who it is saving for.

#### Scenario: Logging before any account exists
- **WHEN** the user records a set before signing in
- **THEN** it is stored under the device identity and queued for delivery like any other

#### Scenario: The same device on a later visit
- **WHEN** the application is reopened on a device that already has a local identity
- **THEN** the same identity is used, and the earlier data is still reachable

#### Scenario: An account is used for the first time
- **WHEN** the user signs in on a device holding data recorded under the device identity
- **THEN** that data is claimed by the account, with every queued mutation preserved

#### Scenario: A second account on the same device
- **WHEN** a different account signs in on a device whose local data was already claimed
- **THEN** the already-claimed data stays with the account that claimed it

### Requirement: Relying-party identifier is fixed before enrollment
The WebAuthn relying-party identifier SHALL be decided and recorded before the first
production passkey enrollment. Production credentials MUST NOT be enrolled against a provider
preview domain.

#### Scenario: Enrollment attempted on a preview origin
- **WHEN** a passkey enrollment is attempted from a non-production preview origin
- **THEN** the enrollment is refused

#### Scenario: The identifier is recorded
- **WHEN** the deployment configuration is inspected
- **THEN** the relying-party identifier is explicit rather than inferred from the request

### Requirement: Row-level authorization on every reachable relation
Row-level security and explicit grants SHALL be enabled on every table and view reachable
through an exposed schema.

#### Scenario: A newly added table
- **WHEN** a migration adds a table reachable through the exposed schema without row-level
  security
- **THEN** the authorization test suite fails

### Requirement: Deny by default is proven, not assumed
For every operation on every protected relation, tests SHALL prove denial for an
unauthenticated identity and for a wrong-user identity.

#### Scenario: Unauthenticated read
- **WHEN** an unauthenticated client reads a protected relation
- **THEN** the read is denied

#### Scenario: Wrong-user read
- **WHEN** an authenticated client reads another user's row
- **THEN** the read is denied

#### Scenario: Wrong-user write
- **WHEN** an authenticated client attempts to modify another user's row
- **THEN** the write is denied

#### Scenario: A missing denial test fails the gate
- **WHEN** a protected relation has no wrong-user denial test for one of its operations
- **THEN** the gate fails

### Requirement: Service-role credentials never reach a client
The service-role credential SHALL remain server-side and MUST NOT appear in a browser bundle,
a service-worker cache, a log, or a trace.

#### Scenario: Building a browser configuration with a service-role key
- **WHEN** a browser configuration is constructed from input carrying a service-role key
- **THEN** the construction fails rather than ignoring the key

#### Scenario: Scanning the client bundle
- **WHEN** the built client bundle is scanned for the service-role key
- **THEN** it is absent

### Requirement: Security-definer functions pin search_path
Any security-definer database function SHALL pin `search_path` safely.

#### Scenario: A security-definer function without a pinned search_path
- **WHEN** a migration adds a security-definer function that does not pin `search_path`
- **THEN** the migration gate fails

### Requirement: Row-level security predicates are indexed
Columns used by row-level security policies SHALL be indexed.

#### Scenario: A policy filters on an unindexed column
- **WHEN** a policy predicate references a column with no index
- **THEN** the migration gate reports it
