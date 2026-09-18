## Why

The first-slice outcome (D-004) is: the user can follow a workout plan and log a session, and
an external AI agent can read the relevant data and propose modifications.

The foundation change built the boundaries, the gates, and three finished capabilities —
telemetry privacy, proposal staleness, and typed measurements. None of it is reachable by a
user. There is no persistence, no authentication, no offline queue, and no serving MCP
endpoint.

**This change is partly implemented.** 24 of 63 tasks are done, and the first user-reachable
behaviour now exists.

Done: the domain and application layer (1.1–1.6); the device side of offline durability — the
atomic IndexedDB outbox (4.1), client-generated idempotency keys (4.2), per-entity ordered
draining (4.4), capped backoff with full jitter (4.5), retry classification (4.6), every flush
trigger the spec names (4.7), the pre-destructive export (4.9), and the guarantee that nothing
discards a queued mutation (4.11); export and import (8.1, 8.2); the initial schema migration
with row-level security, grants, and indexed policy predicates, checked statically (2.1, 2.2,
2.4); the credential policy checks that need no credential (2.7, 3.5); the device's own
identity (3.6); and the plan, workout, and summary routes with session survival (5.1, 5.2).

Not done, and not claimed: there is no server, so nothing has ever synced and no plan can
reach a device except in a test that seeds one. There is no authentication, so nothing claims
the device's data yet (3.7) and the authentication flush trigger is a method nothing calls.
Logging a set, the rest timer, RIR entry, and the sync states are still only design-system
stories, not reachable product behaviour (5.4–5.9). There is no serving MCP endpoint, and no
proposal review (section 7). The schema has never been applied to a database.

Serves: D-003, D-004, D-011, D-012, D-015, D-016, D-017, D-018, D-019, D-020, D-021, D-022,
D-023, D-024, R-003, R-008, R-009, R-010, R-013, R-014, R-020, R-021.

## What Changes

- Persists one active plan containing scheduled sessions, with a monotonic plan revision.
- Adds separately addressable plan, active-workout, and completed-summary states that survive
  refresh, navigation, suspension, and process termination.
- Adds offline session logging through a transactional outbox in IndexedDB, with
  client-generated idempotency keys and server-side idempotent replay.
- Makes synchronized completed-session facts immutable, with corrections as audited revisions.
- Adds passwordless web authentication with email OTP as the guaranteed recovery path.
- Adds row-level authorization with proven deny-by-default behavior for unauthenticated and
  wrong-user identities.
- Makes the remote MCP server actually serve, as an OAuth-protected resource, exposing read
  tools and proposal tools only.
- Adds proposal review in the PWA, wired to the already-implemented staleness rule.
- Adds full JSON export and human-readable CSV export.

## Capabilities

### New Capabilities
- `workout-planning`: one active plan with scheduled sessions and a monotonic revision.
- `workout-logging`: following a session and recording results, offline-first.
- `offline-sync`: the transactional outbox, idempotent replay, ordering, retry, and the three
  user-visible sync states.
- `identity`: passwordless authentication and per-user data authorization.
- `data-portability`: export and recoverable deletion.

### Modified Capabilities
- `agent-proposals`: adds the serving MCP transport, OAuth protected-resource behavior, and
  proposal creation and review over the wire. The staleness rule itself is unchanged.

## Impact

**Affected:** every package. `apps/web` gains real routes and UI; `apps/mcp` starts serving;
`packages/adapters-supabase` gains real implementations; `packages/application` gains use
cases; `packages/domain` gains plan and session aggregates.

**Dependency direction unchanged.** Provider specifics stay in the adapter and are proved by
the existing port contract suites.

**Blocked on external gates.** G-2 (Supabase project), G-3 (production domain and WebAuthn
relying-party ID — a one-way door before any passkey enrollment), G-4 (hosting). Everything in
sections 2 and 3 that needs a running service is blocked on those; what could be proved
statically or on the device has been.

**Blocked on a product decision: what identity the device writes under.** The device store,
the outbox, and the export are all keyed by user. Authentication is blocked on G-2 and G-4, so
there is no signed-in user to key them by, and nothing here decides whether the application is
usable before sign-in or what happens to device-local data when an account is first used.
Sections 5 and 7 build screens that must write under some identity, so they wait on that answer
rather than inventing one.

**Depends on the design system.** Every task that renders substantive UI builds on
`DESIGN_SYSTEM.md`, which is `Accepted` (ADR-0008, change `decide-design-system`). Those tasks
are marked in `tasks.md`. The design system built the minimum proposal review screens the
agent-proposals specification requires as reference-screen stories with baselines
(`decide-design-system` task 5.6); section 7 still implements the reachable feature, and any
review UX richer than that minimum is a first-slice decision that has not been made. Validating the journeys with the target user (R-022)
happens here and closes part of gate G-10.

**Not claimed:** no user-reachable behaviour in this change is implemented. What is done sits
below the presentation boundary: the domain, the use cases, the device store and its outbox,
and export. The device work is proved in a real browser against real IndexedDB, not simulated,
but nothing in the product reaches it — there is no screen, no route, no stored row on a
server, no login, and no MCP response. The proposal, specs, and tasks exist so the rest is
reviewable before it starts.
