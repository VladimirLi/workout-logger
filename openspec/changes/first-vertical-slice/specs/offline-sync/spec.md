## Purpose

Defines how a workout mutation recorded without connectivity reaches the server exactly once,
and what the user is told while that is pending.

## ADDED Requirements

### Requirement: Atomic outbox write
Each offline mutation and its outbox entry SHALL be written in a single atomic transaction.
There MUST be no observable state in which the mutation exists without its outbox entry, or
the outbox entry without its mutation.

#### Scenario: Interruption between mutation and outbox write
- **WHEN** the process is terminated at any point during recording a set offline
- **THEN** either both the mutation and its outbox entry are present, or neither is

### Requirement: Stable client-generated idempotency key
Every logical operation SHALL receive a stable client-generated idempotency key, preserved
across retries. A key MUST NOT be reused for a different payload.

#### Scenario: The key survives retries
- **WHEN** a mutation is retried after a network failure
- **THEN** it carries the same idempotency key as the original attempt

#### Scenario: A reused key with a different payload is refused
- **WHEN** a request presents an idempotency key already recorded against a different payload
- **THEN** the server refuses the request rather than applying it

### Requirement: Server-side idempotent replay
The server SHALL store the idempotency key and the original result in the same transaction as
the accepted mutation, and MUST return the original result on replay rather than applying the
mutation again.

#### Scenario: Replaying an accepted mutation
- **WHEN** a mutation that was already accepted is delivered again with the same key
- **THEN** the server returns the original result and no duplicate record is created

#### Scenario: The key and the mutation commit together
- **WHEN** the transaction that accepts a mutation fails
- **THEN** neither the mutation nor its idempotency record persists

### Requirement: Ordered draining per entity
The system SHALL drain queued mutations in order per entity.

#### Scenario: Two mutations for one session
- **WHEN** two mutations for the same session are queued
- **THEN** the earlier one is delivered and accepted before the later one is attempted

#### Scenario: A blocked entity does not block others
- **WHEN** a mutation for one session is retrying
- **THEN** mutations for a different session may still drain

### Requirement: Retry classification and backoff
The system SHALL retry network errors and responses with status 408, 429, and 5xx using
capped exponential backoff with full jitter, and MUST honour a longer `Retry-After` value.
Other 4xx responses MUST become permanent failures requiring user attention.

#### Scenario: A 429 with Retry-After
- **WHEN** the server responds 429 with a `Retry-After` longer than the computed backoff
- **THEN** the next attempt waits at least the `Retry-After` duration

#### Scenario: A 422 response
- **WHEN** the server responds 422
- **THEN** the mutation becomes a permanent failure and is surfaced as needing attention

#### Scenario: Backoff is jittered
- **WHEN** several mutations fail simultaneously
- **THEN** their retry delays differ, rather than all retrying at the same instant

### Requirement: Multiple flush triggers
Background Sync MAY be used as an optimization but MUST NOT be the only flush mechanism. The
system SHALL also flush on foreground, connectivity restoration, authentication refresh, and
explicit user action.

#### Scenario: A browser without Background Sync
- **WHEN** the application runs in a browser that does not support Background Sync
- **THEN** queued mutations still flush on foreground and on connectivity restoration

#### Scenario: Explicit user flush
- **WHEN** the user triggers a sync explicitly
- **THEN** the queue is drained without waiting for another trigger

### Requirement: Three stable sync states
The system SHALL expose exactly three user-visible sync states: saved on device, syncing, and
needs attention. They MUST be distinguishable without relying on color alone.

#### Scenario: A mutation recorded offline
- **WHEN** a set is recorded with no connectivity
- **THEN** its state is saved on device

#### Scenario: A permanently failed mutation
- **WHEN** a mutation receives a non-retryable error response
- **THEN** its state is needs attention

#### Scenario: Distinguishable in grayscale
- **WHEN** the three states are rendered without color
- **THEN** each remains distinguishable from the others

### Requirement: Queued workout mutations are never discarded automatically
The system SHALL NOT automatically discard a queued workout mutation under any condition,
including quota exhaustion, authentication expiry, or version upgrade.

#### Scenario: Storage quota exhausted
- **WHEN** device storage quota is exhausted
- **THEN** new writes are stopped with a clear recovery action, and existing queued mutations
  are retained

#### Scenario: A destructive recovery action
- **WHEN** the user initiates a recovery action that would clear local data
- **THEN** the system first offers an export of unsynchronized records

### Requirement: Persistent storage state is visible
The system SHALL request persistent browser storage and MUST surface whether it was granted
or denied in diagnostics.

#### Scenario: Persistence denied
- **WHEN** the browser denies persistent storage
- **THEN** diagnostics report the denied state rather than silently continuing

### Requirement: Agent reads wait for synchronized data
Agent reads and proposals SHALL operate on authoritative server data and MUST wait until
pending local mutations are synchronized.

#### Scenario: An agent reads while local mutations are queued
- **WHEN** an agent reads the plan while the device has unsynchronized mutations
- **THEN** the read reflects authoritative server state, and the agent can observe that
  synchronization is pending
