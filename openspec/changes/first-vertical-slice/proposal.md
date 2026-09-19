## Why

The first-slice outcome (D-004) is: the user can follow a workout plan and log a session, and
an external AI agent can read the relevant data and propose modifications.

The foundation change built the boundaries, the gates, and three finished capabilities —
telemetry privacy, proposal staleness, and typed measurements. None of it is reachable by a
user. There is no persistence, no authentication, no offline queue, and no serving MCP
endpoint.

**This change is partly implemented.** 37 of 64 tasks are done. A person can open the
application, follow a plan the device holds, log sets, rest, finish, and reopen any of it later
— with the network off from start to finish. The server side now exists too, against a
development database: the schema is applied, deny-by-default is measured with real signed-in
identities on every relation, the proposal store passes the port contract suite, and a mutation
and its idempotency key commit together. Every write goes through a database function that
derives the identity, the revisions, the transitions, the timestamps, the session's plan facts
and the replay comparison from rows it locks; a signed-in user may read its own rows and nothing
more. ADR-0012 states that trust model as a matrix of invariants, each with the component that
is authoritative for it and the test that proves it.

Done: the domain and application layer (1.1–1.6); the device side of offline durability (4.1–
4.11 except 4.3's server half, now also done); export and import (8.1, 8.2); the schema, its
authorization, and the adapters proved against the development project (2.1–2.7); the
credential policy (3.5) and the device's own identity (3.6); the web experience that does not
need a server (5.1–5.6, 5.8, 5.9 pending its control decision); and the offline journey end to
end (9.1, 9.3).

Not done, and not claimed: there is no authentication in the product — the development tests
sign users in through the admin API, which is not a sign-in screen — so nothing claims the
device's data yet (3.7) and no route talks to the server. Nothing runs in CI, because there are
no repository secrets. There is no serving MCP endpoint (section 6) and no proposal review
(section 7). Nothing is deployed, and no production resource exists.

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
