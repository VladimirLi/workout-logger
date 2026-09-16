## Why

The discovery record (`docs/discovery/decision-record.md`) captured 50 accepted decisions
and 29 research-derived requirements, but nothing in a repository enforced any of them. The
delivery model in D-005 and D-034 lets agents merge normal implementation changes without
human approval — which is only safe if the boundaries, the gates, and the privacy controls
already exist and demonstrably work.

This change converts that discovery evidence into normative repository artifacts and builds
the enforcement machinery. It implements no product feature.

Serves: D-002, D-005 through D-010, D-026 through D-041, R-018, R-027, R-028, R-029.

## What Changes

- Promotes discovery decisions into `VISION.md`, `ROADMAP.md`, `AGENTS.md`, `SECURITY.md`,
  `OBSERVABILITY.md`, `ENGINEERING.md`, `DESIGN_SYSTEM.md`, and seven ADRs. The discovery
  record is preserved unchanged.
- Scaffolds the pnpm TypeScript monorepo from R-027: `apps/web`, `apps/mcp`, and the
  `domain`, `contracts`, `application`, `adapters-supabase`, `observability`, and
  `test-support` packages, with machine-enforced dependency direction.
- Establishes the gate suite from D-037 behind the canonical root commands in R-028, with
  `pnpm verify` as the aggregate.
- Implements three capabilities that are genuinely finished and tested: the telemetry
  attribute allowlist, agent-proposal stale-revision rejection, and typed measurement
  profiles.
- Implements no persistence, no authentication, no offline queue, no serving MCP endpoint,
  and no product UI. Those are separate changes.

## Capabilities

### New Capabilities
- `telemetry-privacy`: what operational telemetry may and may not contain, and the canary
  that proves it.
- `agent-proposals`: how an external agent's write becomes a reviewable proposal, and when
  it is rejected as stale.
- `workout-measurement`: typed quantities, discriminated measurement profiles, and exertion
  semantics.
- `engineering-gates`: the required deterministic gate suite and the guardrail rules that
  keep an agent from weakening it.

### Modified Capabilities
- _(none — this is the first change in the repository)_

## Impact

**Affected packages:** all of them; this creates them.

**Dependency direction:** `apps -> adapters -> application -> domain`, with `contracts`
alongside. Enforced by `pnpm test:architecture`, and the gate's own effectiveness is
asserted by `scripts/architecture-gate.test.ts`.

**Blocked on nothing.** Every gate in this change runs locally without credentials, or
detects its own inapplicability deterministically and says so. Ten external gates remain
open and are recorded in `docs/external-gates.md`; none of them blocks this change.

**Not claimed:** the first vertical slice is not implemented. See the
`first-vertical-slice` change.
