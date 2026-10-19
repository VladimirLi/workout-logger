## Context

The objective is "accepted mutation lost or duplicated: zero", with no error budget, and D-049
wants an immediate notification when data may be lost. Today nothing can say so: the allowlist has
no attribute for it, and the synthetic sync round trip only covers the synthetic user.

Facts about the system that decide what is detectable (read from the repository on 2026-10-19):

- **The database is the only trusted writer** (ADR-0012). The browser calls
  `apply_workout_mutation` on Supabase directly with the user's token
  (`packages/adapters-supabase/src/workout-transport.ts`). **No application server sits on the
  delivery path**, and a database function cannot emit OTLP. Anything "the server detects" is
  either a state the database holds or an event the database records.
- `apply_workout_mutation` claims the idempotency key and applies the mutation in one transaction,
  and stores the accepted payload in `idempotency_records.mutation`. A key reused for a different
  payload returns `key_reused` and **persists nothing**; a replay with the same payload returns
  the original result.
- Rows are never removed by application code. Deletes are tombstones (`recorded_sets.deleted_at`);
  rows go only by `ON DELETE CASCADE` from the user.
- A user holds `SELECT` on their own rows and `EXECUTE` on the boundary functions, and tables
  `FORCE` row level security (ADR-0012, I-2 to I-4).
- ADR-0003: a queued mutation is never discarded automatically; a permanent failure becomes
  `needs attention` and the entry stays queued.

## Decisions

### 1. The candidates

| Candidate | Decision | Why |
|---|---|---|
| **Accepted mutation later missing from the sync round trip** | **Accept** | It is the exact event the zero-loss objective names, and it is **silent**: the device has been told the mutation is safe and has dropped its queue entry, so no one will look. The ledger is authoritative evidence of acceptance (it commits with the mutation), so "ledger entry without its row" is detectable with data that already exists and needs no new storage. Causes it catches: a migration that succeeds and removes data, a restore to an older state, manual SQL, a provider fault. |
| **Idempotency conflict (`key_reused`)** | **Reject for v1** | (a) It is not silent. The server refuses, the client classifies 409 as a permanent failure, the user sees `needs attention`, and the entry stays queued (ADR-0003). The data is still on the device. (b) It is not server-observable today. The function returns without writing anything, and no server code sees the delivery. Making it observable needs a new append-only table written by the refusal path and an emitter to read it: new stored data for a condition that is already loud. (c) It indicates a client defect, which belongs in a bug report from the visible state, not a page. **Reconsider if** an application server joins the delivery path, or the product accepts an append-only integrity record. |
| **Duplicate delivery (idempotent replay)** | **Reject** | A replay of the same payload is the designed behaviour. It is expected after any lost response, which is the normal case on a gym network. Alerting on it would page on correct operation. A duplicated *fact* is prevented structurally: the key is claimed before the mutation is applied in the same transaction, set and session identifiers are primary keys, and `(session, sequence)` is unique. A violation raises and rolls back, so it cannot produce a stored duplicate to detect. |
| **Failed migration** | **Reject as a signal; keep its useful half** | A failed migration is a failed required step. The `database-migrate` job fails, the deploy does not proceed (G-4), and the run is visible without telemetry. It is a release problem; it does not mean data is gone. The risky cases are (i) a migration that *succeeds* and removes data, and (ii) one that fails part-way and leaves an unknown state. Both are exactly "an accepted mutation is now missing", so the check runs after **every** migration run, successful or not (requirement below). Whether the Supabase CLI wraps each file in a transaction was not verified; the design does not depend on it. |
| **Failed or unverified pre-migration backup (G-8)** | **Reject as a data-loss signal** | The backup job is fail-closed and the migrate job `needs` it. A failed backup means the migration **did not run**, so nothing changed and nothing was lost. Reporting it as possible data loss would page on a blocked release and teach the alert to be ignored. It is also not an application event; routing it through the telemetry package would need a workflow to emit OTLP. If a page on a blocked release is wanted, that is a deploy-failure alert (T3 or T8), a separate decision. The backup's own correctness is proved by the rehearsal and the restore drill (G-8), not by this signal. |

Two of the rejections turn on the same point: a condition that is already visible to the user, or
that stops the change before it can lose data, is not what D-049's possible-data-loss class
exists for. The class is loss that **no one is looking at**.

### 2. The check

A read-only comparison of the idempotency ledger against the stored facts, inside the database:

For every ledger entry whose stored `mutation` is one of the six workout kinds, the entity it names
must exist:

| `mutation.kind` | Expected row |
|---|---|
| `start_session` | a `workout_sessions` row with `id = mutation.session.id` |
| `record_set` | a `recorded_sets` row with `set_id = mutation.set.setId` |
| `complete_session` | a `workout_sessions` row with `id = mutation.sessionId` and `status = 'completed'` |
| `edit_set`, `delete_set`, `restore_set` | a `recorded_sets` row with `set_id = mutation.setId` (a tombstoned row is present) |

- **One statement.** The comparison is a single SQL statement, so it reads one snapshot. A ledger
  entry and its row commit together, so a statement cannot see the entry without the row unless one
  is truly gone. Two statements could race an in-flight delivery and report a loss that did not
  happen.
- **Direction: ledger to rows only.** Pruning the ledger later (no retention policy exists yet)
  removes entries, not facts, so it cannot raise a false positive. Rows without a ledger entry
  (plan changes from accepted proposals, rows from before the ledger kept payloads) are not
  examined.
- **Entries with no stored payload** (`mutation IS NULL`, from before the column existed) cannot be
  checked. They are skipped, not counted as missing.
- **Output is a count to the caller.** No identifier, key, payload or measurement leaves the
  function. An operator who needs to know *which* entries are missing queries the ledger directly
  under an owner role during the incident.
- **Reads across users.** Tables `FORCE` row level security, so the check needs a role that bypasses
  it. G-8's `ci_backup` is the existing pattern, and its `BYPASSRLS` boundary is itself unverified.
  The implementation records which mechanism it used and states that boundary as unverified until
  run against the development project. The runner's credential may execute this one function and
  nothing else.
- **Retries.** The runner retries a failed attempt up to three times with backoff before reporting
  `check_failed`, so one dropped connection does not page.

### 3. The closed telemetry value

One new event name and one new attribute:

| | Value |
|---|---|
| Event name | `integrity.check` |
| Attribute | `integrity.outcome` |
| Domain (closed enum) | `ok`, `mutation_missing`, `check_failed` |

- `ok`: the check completed and found no missing entry.
- `mutation_missing`: the check completed and found at least one.
- `check_failed`: the check could not complete after its retries. It is never reported as `ok`.

The count of missing entries is deliberately **not** an attribute or observation. It would be a new
numeric domain nothing in the alert needs, and the operator reads the exact figure from the
database.

**Section 2.1 classification** (to be added to the telemetry design by the guardrail PR):

| Allowlisted attribute | Role in OTLP | Why |
|---|---|---|
| `integrity.outcome` (3) | metric label | Enumerated |

| Event | Instrument | Labels | Ceiling of series |
|---|---|---|---|
| `integrity.check` | counter | `integrity.outcome` | 3 |

The mapping fixes the dimension. `synthetic`, `duration.ms` or anything else an `integrity.check`
event happens to carry is not a label. The ceiling rises by 3 for the one emitting service, so the
totals in section 2.1 (about 2,100 per service, 4,200 for both) are unchanged to the stated
precision and the 5,000 test ceiling holds. There is no `synthetic` label because the check covers
every user, the synthetic user included, and the alert must not exclude it.

**What the guardrail PR changes, mechanically** (`packages/observability`, its own PR, D-035):

1. `allowlist.ts`: add `'integrity.outcome'` to `ALLOWED_ATTRIBUTES`; add `'integrity.check'` to
   `EVENT_NAMES`; add `export const INTEGRITY_OUTCOMES = ['ok', 'mutation_missing',
   'check_failed'] as const`; add `'integrity.outcome': oneOf(INTEGRITY_OUTCOMES)` to `DOMAINS`.
   `DOMAINS` is typed `Record<AllowedAttribute, Domain>`, so the compiler forces the entry.
2. The OTLP mapping: `integrity.check` is a counter whose only label is `integrity.outcome`.
3. Tests: `closed-domains.test.ts` accepts each of the three values and rejects a fourth, a
   sentinel string, a number and a boolean; the cardinality test's classification table gains the
   row and still passes; the wire canary emits `integrity.check` through its entry point and the
   sentinel appears nowhere.
4. Docs in the same guardrail PR: the allowlist and value-domain tables in `OBSERVABILITY.md`, the
   event and row in section 2.1 of the telemetry design, and the allowlist sentence in the
   `telemetry-privacy` spec.

The runner uses the existing `service.name` `workout-web`. A third service name would be a further
guardrail change and none is needed.

### 4. When and where it runs

- At least once every 6 hours, and after every run of `database-migrate` against an environment,
  whether the migrate job succeeded or failed.
- The runner must emit through `packages/observability` only, behind the same start-up canary gate
  as any other emitter. It must not call an OpenTelemetry SDK directly.
- **Recommended mechanism, for the implementation issue to confirm or change:** a repository script
  run by a scheduled workflow and by a post-migration step, rather than a public application
  route. A route needs its own authentication and abuse handling; a script has neither surface. The
  decision belongs to the implementation issue because both options meet this spec. The workflow
  files are guardrail paths and ship as their own PR.
- On a post-migration run, a non-zero count or a failed check **fails the workflow job** and writes
  the outcome to the job summary. That stops the release independently of telemetry.
- The interval is a ceiling on detection latency. Notification after detection is immediate. The
  cost of a check at single-user scale is negligible, so a shorter interval is allowed; a longer
  one is not without changing this spec.

### 5. Boundary gate

ADR-0012 (I-4) lists the four boundary functions that `authenticated` may execute and says no other
function this repository defines is reachable. `scripts/check-db-boundary.mjs` enforces it. The new
function is reachable by the check role only, so the gate and the invariant matrix need a reviewed
entry for it. `scripts/` is a guardrail path: that edit is its own PR and lands before the
migration. This is a dependency, recorded in `tasks.md`; it is not weakening a gate.

### 6. Alerts and drill

Both are separate issues, blocked on T3 (Grafana stack, tokens, contact points).

| Alert | Condition | Routes |
|---|---|---|
| Possible data loss | any increase in `integrity.check` with `integrity.outcome` of `mutation_missing` or `check_failed` | A + B |
| Integrity check silent | no `integrity.check` of any outcome for 12 h (NoData = alerting) | A + B |

The first alert sends on `check_failed` because a check that cannot run proves nothing, and the
objective is zero. The second covers a dead runner, a dead scheduler and a dead exporter, none of
which would otherwise produce a signal. Neither rule filters on `synthetic`.

Drill, against a **non-production** stack and database: (1) remove one row that a ledger entry
names, as the owner role on a scratch or development database; (2) run the check; (3) confirm one
`mutation_missing` and both Telegram and the signed Hermes webhook receive the alert; (4) stop the
runner and confirm the silent alert, using the `drill=true` rule with a shortened window; (5) point
the check at an unreachable database and confirm `check_failed` alerts. Record date, evidence and
who signed it off, someone other than the runner (the Platform & Reliability role may not sign off
its own drill).

## Coverage: what this does and does not close

Covers: an accepted workout mutation (six kinds) whose stored entity is gone, found within the
check interval, with a notification on both paths.

Does **not** cover:

- **Loss before acceptance.** A mutation lost on the device (storage eviction, a cleared profile)
  never reaches the ledger, so no server check can see it. ADR-0003 (never discard, export before a
  destructive action, persistent-storage state in diagnostics) is the protection, and it is
  user-visible, not alerted.
- **Alteration.** A fact whose row exists but whose value changed is not detected. The check proves
  presence, not equality. Equality would need a stored digest per fact; a larger change that this
  spec does not take on.
- **Proposals and plan data.** The ledger check covers the six workout kinds. Plan revisions and
  proposals have their own invariants (ADR-0012 I-5 to I-9).
- **Latency below the interval.** Loss is detected within the interval, not at the moment it
  happens.
- **Recovery.** The signal does not restore anything. With no point-in-time recovery and no
  scheduled backups (G-8, accepted risk), recovery is from the last pre-migration dump, which
  predates the latest migration. The runbook states this plainly.

The proposal asks Vladimir to decide whether this satisfies D-049 for the possible-data-loss class.
If it does not, the only alternative in the design is a narrowing of D-049 and OBSERVABILITY.md,
which is a product-intent change an agent cannot make (D-7b).

## Alternatives rejected

- **Read back every accepted mutation right after commit.** It proves nothing Postgres has not
  already guaranteed, puts a second query on the sync path (the 60-second objective), and cannot see
  loss that happens later, which is the real risk.
- **Client-reported loss.** The device is untrusted input (ADR-0012), browser instrumentation is
  unstable and may not be the sole source of an alert (OBSERVABILITY.md), and a device that has lost
  data is the least likely to report it.
- **One outcome per root cause** (`lost_after_migration`, `lost_after_restore`). The check cannot
  know the cause, and extra values widen the closed domain for no decision.
- **A numeric count as an attribute.** A new bounded-integer domain that nothing consumes; the
  figure is available from the database.
- **Reusing `response.class`, `operation.type` or `migration.applied`.** Each has a declared
  meaning; overloading one makes a dashboard lie.
- **A row-count comparison against the backup as the signal.** It exists in the backup job to verify
  the restore, and it runs only at migration time. The gap this change closes is between
  migrations.
- **Alerting on the workflow failure alone.** It would reach one path only, and D-049 requires two
  independent ones.

## Risks

- **False positive from a future feature that deletes facts** (an account-deletion or data-erasure
  feature). Cascades from the user remove ledger entries and rows together, which is correct. A
  feature that removes accepted facts for a user who stays must remove or mark their ledger entries
  in the same transaction, or the check will rightly flag them. That feature's spec must say so.
- **The check role is a broad read credential.** It can read every user's rows. It is confined to
  one count-only function, and it is not issued by this change: a production credential is G-9.
- **A silent runner looks like a quiet system.** Mitigated by the silent-check alert, which is part
  of the requirement and not optional.
- **Unverified boundary.** Nothing here ran against Supabase. The `BYPASSRLS` role, the scheduled
  workflow, the function grant and the alert path are all unrun until the implementation and the
  drill.
