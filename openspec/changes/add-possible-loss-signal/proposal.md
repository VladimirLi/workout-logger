## Why

D-049 requires an immediate notification for possible data loss, and OBSERVABILITY.md lists
"accepted mutation lost or duplicated: zero" as an objective with no error budget. The telemetry
design (`docs/design/telemetry-and-synthetic-checks.md`, section 6) found that nothing in the
allowlist can say "a mutation was lost", so the class has no signal, no alert and no drill, and G-5
cannot close while that is true (D-7b, approved 2026-10-01). The design left the signal itself to an
OpenSpec change (T11) because it adds a stored-data check and a new closed telemetry value.

This is task T11, spec half. Implementation, the allowlist guardrail PR, the alert rule and the
drill are separate issues created after approval.

Serves: D-049 (possible data loss), R-018 (metadata-only telemetry), R-019 (SLO: accepted mutation
lost or duplicated is zero), ADR-0003 (never discard a queued mutation), ADR-0012 (the database is
the only trusted writer), D-035, D-050, VLA-713, VLA-256, G-5, G-8.

## What Changes

- **One signal, one candidate accepted.** The server can reliably detect one possible-loss
  condition with data it already holds: an *accepted mutation that is missing from the stored
  facts*. The idempotency ledger records every accepted workout mutation; a read-only check compares
  each ledger entry with the row it must have produced. Four other candidates are rejected, with
  reasons, in `design.md`:

  | Candidate | Decision |
  |---|---|
  | Accepted mutation later missing from the sync round trip | **Accepted** |
  | Idempotency conflict (`key_reused`) | Rejected for v1 |
  | Duplicate delivery (idempotent replay) | Rejected, it is designed behaviour |
  | Failed migration | Rejected as a signal; the post-migration check covers a migration that succeeds and loses data |
  | Failed or unverified pre-migration backup (G-8) | Rejected as a data-loss signal; it blocks the migration and nothing is lost |

- **A check, not a repair.** The check is read-only, returns a count to its caller, and never
  alters, replays, discards or re-queues anything (ADR-0003, D-050).
- **When it runs.** At least once every 6 hours, and after every production migration run,
  successful or not.
- **New closed telemetry:** event `integrity.check` and attribute `integrity.outcome`, domain
  `ok`, `mutation_missing`, `check_failed`. Section 2.1 classification: metric label, three values,
  a plain counter, three series. Exact allowlist and mapping changes are in `design.md` so the
  guardrail PR is mechanical.
- **Alerting requirement.** Any outcome other than `ok`, and no outcome at all for 12 hours, route
  to both paths (Telegram and the Hermes webhook) and are drilled before G-5 may close.

## Capabilities

### New Capabilities
- `data-integrity-signal`: the accepted-mutation integrity check, its closed outcome, and the
  alert and migration-workflow requirements that follow from it.

### Modified Capabilities
- _(none)_ The `telemetry-privacy` capability is introduced by `establish-project-foundation`,
  which is not archived. This change adds one attribute and one event name to its closed sets; it
  does not weaken any existing rule. The guardrail PR that edits `allowlist.ts` also updates the
  allowlist list in that spec and the tables in OBSERVABILITY.md (see `tasks.md`).

## Impact

**Edited here:** only `openspec/changes/add-possible-loss-signal/`. No product code, guardrail
file, migration, workflow, credential or cloud resource is touched or requested.

**Affected when implemented:**
- `supabase/migrations/` (product): one count-only function and one read-only role grant.
- `packages/application` (a use case and a port), `packages/adapters-supabase` (the adapter and its
  contract suite), `packages/test-support` (builders and a deliberate-loss case).
- `packages/observability` (**guardrail, its own PR**): the attribute, the event name and the
  mapping.
- `scripts/check-db-boundary.mjs` (**guardrail, its own PR**): the invariant matrix and the gate
  list the grant of a new function; see design, "Boundary gate".
- `.github/workflows/` (**guardrail, its own PR**): a post-migration step in `database-migrate` and
  the scheduled run.
- `docs/design/telemetry-and-synthetic-checks.md` (alert table, section 2.1 row) and
  `docs/runbooks/` (an integrity-check runbook).

Dependency direction holds: apps -> adapters -> application -> domain, with contracts alongside.

**What this does not cover** (stated so G-5 is not closed on a false premise; design, "Coverage"):
loss before the server accepted a mutation (the outbox and the device, ADR-0003), a stored value
that was altered rather than removed, and detection sooner than the check interval. Whether that
coverage satisfies D-049 for the possible-data-loss class is the approval question below.

**Owner gate.** This stores no new data, but it adds a telemetry value and a production alert for
a D-049 class, which is product intent, so it needs spec approval on the PR after independent
review (AGENTS.md). Two decisions need an explicit yes or no from Vladimir:

1. Reject `key_reused`, replay, failed-migration and failed-backup as data-loss *signals*, as
   argued in `design.md`. Reversing any of them is a larger change (new stored data or a different
   emitter), not a toggle.
2. Accept a check interval of at most 6 hours as "immediate" for this class. Detection latency is
   the interval; notification after detection is immediate.

**Does not close G-5.** G-5 stays open until T12 and the whole breakdown ship, with this signal's
alert drilled against a non-production stack. The alert and drill depend on T3, which needs Grafana
accounts that do not exist. This change requests none.
