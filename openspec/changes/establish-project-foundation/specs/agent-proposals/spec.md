## Purpose

Defines how an external AI agent's intent to change workout data becomes a reviewable
proposal, and when that proposal is rejected as stale rather than applied.

## ADDED Requirements

### Requirement: Agents hold no direct write authority
An external agent SHALL NOT mutate authoritative product data. Every write operation
exposed to an agent MUST create a proposal. Reads MAY be immediate for an authenticated
client.

#### Scenario: Every agent write tool is a proposal tool
- **WHEN** the exposed MCP tool surface is inspected
- **THEN** every write-shaped tool name is a proposal tool, and no tool performs a direct
  mutation

#### Scenario: No general-purpose or administrative tool is exposed
- **WHEN** the exposed tool surface is inspected
- **THEN** it contains no SQL tool, query tool, arbitrary patch operation, direct delete,
  deployment tool, credential tool, or administration tool

### Requirement: Proposal evidence
A proposal SHALL record the proposal identifier, the authenticated actor and client, the
base revision it was computed against, a canonical structured diff, the agent's rationale,
creation and expiry timestamps, and an input hash.

#### Scenario: A proposal without a base revision is rejected
- **WHEN** a proposal payload omits its base revision
- **THEN** the contract rejects the payload, because staleness cannot be evaluated without
  it

#### Scenario: A proposal without a rationale is rejected
- **WHEN** a proposal payload carries an empty rationale
- **THEN** the contract rejects the payload

#### Scenario: Evidence survives acceptance
- **WHEN** a proposal is accepted
- **THEN** the accepted record still carries the original base revision, diff, rationale,
  input hash, and actor

### Requirement: Stale base revision is rejected, never rebased
If the authoritative base revision differs from the proposal's base revision at the moment
the user decides, the system SHALL reject the proposal as stale and MUST NOT rebase, merge,
or partially apply it. The rejection MUST report both revisions so the agent can regenerate.

#### Scenario: The plan advanced after the proposal was created
- **WHEN** a proposal was computed against revision 5 and the authoritative revision is 6
- **AND** the user accepts the proposal
- **THEN** the result is a stale-base-revision rejection reporting base 5 and current 6
- **AND** no part of the proposed change is applied

#### Scenario: The revision differs in either direction
- **WHEN** a proposal's base revision does not equal the authoritative revision, whether
  higher or lower
- **THEN** the result is a stale-base-revision rejection

#### Scenario: The authoritative revision is read at decision time
- **WHEN** the authoritative revision matches when the proposal is displayed but changes
  before the user decides
- **THEN** the decision produces a stale-base-revision rejection

#### Scenario: A matching revision permits acceptance
- **WHEN** a proposal's base revision equals the authoritative revision and the proposal has
  not expired
- **THEN** the proposal is accepted

### Requirement: The proposal diff is a closed set of operations
A proposal's diff SHALL be one of the operations the current slice supports, validated at
the boundary. An arbitrary or unrecognised shape MUST be rejected before the proposal is
recorded, and MUST NOT reach the user for review.

#### Scenario: An unrecognised operation
- **WHEN** a proposal arrives whose diff names an operation that is not supported
- **THEN** the proposal is rejected

#### Scenario: An arbitrary payload in place of a diff
- **WHEN** a proposal arrives whose diff is a string, a number, an array, a bare object, a
  SQL statement, or a JSON-patch document
- **THEN** the proposal is rejected

#### Scenario: An unknown field inside a valid operation
- **WHEN** a proposal carries a supported operation with an extra field, at the top level or
  nested inside a session or a prescription
- **THEN** the proposal is rejected

#### Scenario: A diff large enough to be unreviewable
- **WHEN** a proposal carries more sessions or corrections than the declared bound
- **THEN** the proposal is rejected

#### Scenario: A change that changes nothing
- **WHEN** a proposal carries an empty correction list, or a session change specifying no
  new value
- **THEN** the proposal is rejected

### Requirement: Compare and decide atomically
The decision on a proposal SHALL compare the expected revision and the expected status and
persist the outcome as a single atomic operation. Reading the revision, evaluating the rule,
and writing the result as separate steps MUST NOT be sufficient, because another actor can
commit inside that window.

#### Scenario: The plan advances inside the commit window
- **WHEN** the authoritative revision changes between the revision read and the commit of a
  decision
- **THEN** the commit is refused and the decision is reported as a stale base revision

#### Scenario: Two proposals race on the same base revision
- **WHEN** two proposals computed against the same base revision are accepted concurrently
- **THEN** exactly one is accepted, the other is rejected as stale, and the plan revision
  advances exactly once

#### Scenario: A refused commit changes nothing
- **WHEN** a commit is refused because the revision moved
- **THEN** the stored proposal status is unchanged and the plan revision is unchanged

#### Scenario: Accepting advances the revision, rejecting does not
- **WHEN** a proposal is accepted
- **THEN** the plan revision advances exactly once
- **WHEN** a proposal is rejected
- **THEN** the plan revision is unchanged

#### Scenario: A second decision on the same proposal
- **WHEN** the same proposal is decided twice concurrently
- **THEN** exactly one decision succeeds and the other is refused

### Requirement: Stale proposals reach a terminal status
When a proposal is rejected as stale, the system SHALL persist a terminal stale status so
the proposal is not offered for review again and the agent can observe that it must
regenerate.

#### Scenario: The stale marker is persisted
- **WHEN** a decision on a proposal produces a stale rejection
- **THEN** the stored proposal's status is the terminal stale status

#### Scenario: A stale proposal cannot be reviewed again
- **WHEN** a proposal already marked stale is submitted for review
- **THEN** the result is an already-decided rejection

### Requirement: Proposal expiry precedes staleness
A proposal decided at or after its expiry timestamp SHALL be rejected as expired. When both
expiry and staleness apply, the system MUST report expiry.

#### Scenario: Decided exactly at the expiry instant
- **WHEN** a proposal is decided at precisely its expiry timestamp
- **THEN** the result is an expired rejection

#### Scenario: Both expired and stale
- **WHEN** a proposal is both past its expiry and computed against a moved base revision
- **THEN** the result is an expired rejection, not a stale rejection

### Requirement: A user may reject a stale proposal outright
The system SHALL allow a user to reject a proposal whose base revision has moved, so that no
proposal is stranded as permanently pending. Expiry and a prior decision MUST still block.

#### Scenario: Rejecting a proposal with a moved base revision
- **WHEN** the user rejects a proposal whose base revision no longer matches
- **THEN** the proposal's status becomes rejected

#### Scenario: Rejecting an already-decided proposal
- **WHEN** the user rejects a proposal that was already rejected
- **THEN** the result is an already-decided rejection

### Requirement: Every MCP invocation is re-authorized
The system SHALL authorize each tool invocation independently, validating token expiry,
audience, and the scope required by that specific tool. There MUST be no per-connection
authorization cache.

#### Scenario: An expired access token is refused
- **WHEN** a tool is invoked with a token whose expiry has passed
- **THEN** the invocation is refused as token-expired

#### Scenario: A token issued for another audience is refused
- **WHEN** a tool is invoked with a token whose audience differs from the resource
  identifier
- **THEN** the invocation is refused as an audience mismatch

#### Scenario: Read and proposal scopes are enforced separately
- **WHEN** a client holding only the read scope invokes a proposal tool
- **THEN** the invocation is refused for a missing proposal scope

#### Scenario: An unrecognized tool is refused before scope evaluation
- **WHEN** a tool name that is not on the exposed surface is invoked
- **THEN** the invocation is refused as an unknown tool

### Requirement: Access token lifetime bound is enforced
Access tokens for the MCP resource SHALL be minted with a lifetime of at most 15 minutes,
and the authorization boundary MUST enforce that lifetime rather than only checking whether
the token has expired. A token's validity window MUST be well formed, and the window MUST be
evaluated before scope.

#### Scenario: The configured maximum lifetime
- **WHEN** the maximum access-token lifetime is inspected
- **THEN** it is 15 minutes or less

#### Scenario: A long-lived token is refused before it expires
- **WHEN** a tool is invoked with a token minted for a lifetime longer than the maximum
- **THEN** the invocation is refused, even though the token has not yet expired

#### Scenario: A token at exactly the maximum lifetime is accepted
- **WHEN** a tool is invoked with a token minted for exactly the maximum lifetime and not
  yet expired
- **THEN** the invocation is authorized

#### Scenario: A malformed validity window is refused
- **WHEN** a token's expiry is not after its issuance, or either timestamp is unparseable
- **THEN** the invocation is refused

#### Scenario: The validity window is checked before scope
- **WHEN** a token has both an over-long lifetime and insufficient scope
- **THEN** the refusal names the lifetime, because a token we will not accept is not one
  whose scopes we reason about
