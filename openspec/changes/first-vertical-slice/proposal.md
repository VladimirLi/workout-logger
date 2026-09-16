## Why

The first-slice outcome (D-004) is: the user can follow a workout plan and log a session, and
an external AI agent can read the relevant data and propose modifications.

The foundation change built the boundaries, the gates, and three finished capabilities —
telemetry privacy, proposal staleness, and typed measurements. None of it is reachable by a
user. There is no persistence, no authentication, no offline queue, and no serving MCP
endpoint.

**This change is specified and not implemented.** Every task below is unchecked, and that is
an accurate statement of the repository's state.

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
relying-party ID — a one-way door before any passkey enrollment), G-4 (hosting). Sections 2
onward cannot be implemented until G-2 closes.

**Blocked on the design system.** Every task that renders substantive UI depends on
`DESIGN_SYSTEM.md` reaching `Accepted` — see the `decide-design-system` change and gate G-10.
Those tasks are marked in `tasks.md` and MUST NOT be started while that status is
`NOT DECIDED`. Non-visual work in sections 1 through 4 is not blocked by it.

**Not claimed:** nothing in this change is implemented. The proposal, specs, and tasks exist
so the work is reviewable before it starts.
