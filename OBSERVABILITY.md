# Observability Policy

**Status:** Normative. Changes to the telemetry allowlist are guardrail changes.
**Source:** Promoted from [docs/discovery/decision-record.md](docs/discovery/decision-record.md).

## The rule

Production logs, metrics, and traces retain **structured operational metadata only**. They
must not contain workout content or agent rationale (D-047). This is enforced by an
allowlisting processor and proved by a canary test, not by reviewer vigilance.

## Allowlist (R-018)

Naming an attribute is **not sufficient**. An allowlist that checks only the key and then
accepts any short string turns every allowlisted key into a smuggling channel:
`operation.type` carries an exercise name, `http.route` carries a resolved path with a query
string. So every attribute additionally has a **closed value domain** — an enum, a bounded
integer, a boolean, or a pattern that free text cannot satisfy.

Only these low-cardinality attributes may be exported, and only with a value inside its
domain. Anything else is **dropped**, not passed through.

| Attribute | Example |
|---|---|
| `service.name`, `service.version` | `workout-web`, `1.4.2` |
| `deployment.environment` | `production`, `preview` |
| `http.route` (template only) | `/sessions/[id]` — never the resolved path |
| `operation.type` | `log_set`, `sync_flush`, `proposal_create` |
| `response.class` | `2xx`, `4xx`, `5xx` |
| `duration.ms` | `142` |
| `retry.count` | `3` |
| `queue.state` | `saved_on_device`, `syncing`, `needs_attention` |
| `migration.version` | `0007` |
| `synthetic` | `true` / `false` |

### Value domains

| Attribute | Domain |
|---|---|
| `service.name` | enum: `workout-web`, `workout-mcp` |
| `service.version` | plain semver, `N.N.N` — no pre-release or build metadata |
| `deployment.environment` | enum: `development`, `test`, `preview`, `production` |
| `http.route` | enum of **enumerated route templates**, not a pattern |
| `operation.type` | enum of declared operations |
| `response.class` | enum: `1xx`…`5xx` |
| `duration.ms` | integer, `0`…`86_400_000` |
| `retry.count` | integer, `0`…`100` |
| `queue.state` | enum: `saved_on_device`, `syncing`, `needs_attention` |
| `migration.version` | 4–14 digits |
| `synthetic` | boolean only — the string `"true"` is rejected |

`http.route` is **enumerated rather than pattern-matched** on purpose. A pattern cannot tell
`/sessions/[id]` from `/sessions/abc123`; both are just slashes and segments. Enumerating the
templates is the only way that field cannot carry a resolved identifier. Adding a route means
adding it to the list, which is the point.

### Event names are closed too

The event name is itself part of the export, so an unconstrained name
(`workout.logged.bench_press_92kg`) leaks exactly what the attribute allowlist prevents.
Event names come from a closed set. An event with an undeclared name is **dropped entirely** —
not exported under a sanitised name, because that would still betray that something happened
under a name we refused.

### Forbidden, without exception

URLs, headers, query strings, tokens, exercise names, notes, weights, repetitions, RIR/RPE
values, body data, agent rationales, proposal diffs, and any free text.

### Canary test

A CI and runtime canary emits sentinel workout content through the normal instrumentation
path and asserts the sentinel never reaches the exporter. The canary is a required gate.
If it cannot run, the gate fails — it is not skipped.

## Implementation constraints

- Use OpenTelemetry **stable** trace and metric APIs and stable HTTP semantic conventions.
- Treat browser instrumentation and the OpenTelemetry JavaScript **logs** API as unstable:
  pin versions, and never make them the sole source for an alert.
- Server instrumentation initializes **before** application modules load.
- The approved telemetry API and the allowlist live in `packages/observability`. Nothing
  else may call an OpenTelemetry SDK directly; the architecture gate enforces this.

## Service level objectives (R-019)

30-day rolling window:

| SLO | Target |
|---|---|
| Critical authenticated journeys succeed | ≥ 99.0 % |
| Queued workout mutation synchronizes within 60 s of usable connectivity | ≥ 99.5 % |
| Accepted mutation lost or duplicated | **zero** |
| Production synthetic critical journeys pass | every deployment, and ≥ every 15 min |

Exhausting the availability or synchronization error budget **pauses feature deployment**
until reliability is restored. The lost-or-duplicated objective has no error budget.

Operational telemetry retention: 30 days initially.

## Alerting (D-049)

Notify the user **immediately** for security, possible data-loss, authentication, or
critical-journey failures.

Dual-path, deliberately independent:

1. An independent alert manager sends the primary human notification directly to Telegram.
2. It independently sends a signed, **metadata-only** webhook to a narrowly scoped Hermes
   incident workflow.

Hermes is not in the paging critical path. Either path may fail without suppressing the
other. Hermes may diagnose and open a tested fix PR; it may not mutate production (D-050).

Grafana Cloud Alerting is the provisional provider because it supports both Telegram
contact points and generic webhooks. Pricing and operational fit are confirmed at setup
time — an external gate, see [docs/external-gates.md](docs/external-gates.md).

## Production verification (D-045, D-046)

Post-deployment verification covers service health, authentication, plan loading, offline
queue behavior, synchronization, proposal review, and MCP smoke tests.

Synthetic checks run against an **isolated synthetic account and data set**, excluded from
normal views and from agent recommendations. Synthetic telemetry carries `synthetic=true`
so it never contaminates the SLO numerator for real user journeys.

Failed post-deployment health or synthetic verification triggers **automatic rollback**
(D-043).

## First-slice product evidence (R-001)

Separate from operational telemetry, and still privacy-safe. Record only enough to derive:

- planned workouts started and completed;
- sessions completed without data loss;
- offline entries eventually synchronized;
- proposals reviewed, accepted, rejected, or rejected as stale;
- time and recoverable errors along each critical journey.

These are counts and durations. They are not workout content.
