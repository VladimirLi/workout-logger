# Design: telemetry, alerting and synthetic checks (G-5)

**Status:** Accepted for D-1 to D-5 and D-7 (Vladimir, 2026-10-01, VLA-256 confirmations); D-6
declined. Nothing here is provisioned or run. It changes no product intent by itself. Pricing and limits were read
from Grafana's public pages on 2026-09-30 and are re-confirmed at account setup (G-5).
**Inputs:** [OBSERVABILITY.md](../../OBSERVABILITY.md) (normative, not changed here),
[external-gates.md](../external-gates.md) G-4, G-5, G-9, [ROADMAP.md](../../ROADMAP.md) O-3.

## 1. Shape

```text
apps/web, apps/mcp
   └─ packages/observability            allowlist + closed event names, then OTLP exporter
        └─ OTLP/HTTP ─────────────────► Grafana Cloud (metrics, traces)
                                          ├─ alert rules ─► Telegram contact point   (path A)
                                          └─ alert rules ─► signed webhook ► Hermes  (path B)
Grafana Synthetic Monitoring (15 min) ──► same Grafana stack
GitHub Actions verify-deployment (each deploy) ─► exit code to the G-4 deploy workflow
```

Decisions in one line each:

- One backend (Grafana Cloud), one SDK entry point (`packages/observability`), one alert manager.
- **Metrics drive every alert.** Traces are for diagnosis. The OpenTelemetry JavaScript logs API
  and browser instrumentation are unstable (OBSERVABILITY.md), so neither is used in v1.
- Alert rules, contact points and routing are code in the repository and applied by workflow, not
  clicked together in a UI.

## 2. Export path, only through `packages/observability`

Today `Telemetry.record(name, attributes)` sanitizes and hands an event to a `TelemetryExporter`.
The default is `NoopExporter`. The change is one new exporter behind that interface, not a second
API:

- `OtlpExporter` maps each closed event name to OpenTelemetry **stable** signals, plus a span for
  `http.server.request`. Being on the attribute allowlist makes a value safe to export; it does not
  make it safe as a metric label. Each allowlisted attribute is therefore classified once, and the
  mapping follows the classification (section 2.1).
- Use the official OpenTelemetry JS SDK and the OTLP/HTTP exporter. No custom protocol or client.
- **Resource attributes are a bypass.** SDK defaults and resource detectors add `host.*`,
  `process.*` and `telemetry.sdk.*`, none of which are on the allowlist. The exporter builds its
  resource explicitly from `service.name`, `service.version` and `deployment.environment`, and
  disables detectors. Span names, metric names and instrumentation scope names are fixed strings.
- Initialization happens before application modules load (already required by OBSERVABILITY.md).
- Unconfigured means `NoopExporter`. A missing endpoint or token never falls back to anything else
  and never fails a request.
- Vercel's own request logs are outside this path and contain resolved URLs. They are not
  forwarded to Grafana (no log drain, no Vercel OTel integration). Their retention is a Vercel
  setting recorded in the G-4 ADR.

### 2.1 Metric labels, observations and series budget

`duration.ms` admits any integer up to 86,400,000 and `retry.count` up to 100. `migration.version`
is a 4 to 14 digit string. Used as labels, each distinct value would be a new series. So:

| Allowlisted attribute | Role in OTLP | Why |
|---|---|---|
| `http.route` (4 values) | metric label | Enumerated |
| `operation.type` (8) | metric label | Enumerated |
| `response.class` (5) | metric label | Enumerated |
| `queue.state` (3) | metric label | Enumerated |
| `synthetic` (2) | metric label | Boolean; keeps the SLO numerator separable |
| `duration.ms` | **histogram observation, never a label** | Fixed explicit bucket boundaries: 5, 10, 25, 50, 100, 250, 500, 1,000, 2,500, 5,000, 10,000, 30,000, 60,000 ms. The 60,000 boundary exists so the 60-second sync SLO is a bucket ratio rather than an estimate |
| `retry.count` | **histogram observation, never a label** | Bounds 0, 1, 2, 3, 5, 10 |
| `service.name`, `deployment.environment` | resource attributes | Constant per process; separate stacks or tokens per environment (section 9) |
| `service.version` | resource attribute on `target_info`, not a label on every series | Alerts and dashboards join to it; cost is one `target_info` series per release, not a multiplier |
| `migration.version` | **not exported in v1** | Unbounded pattern; nothing in the SLOs or alerts needs it. A spec can reclassify it later |

Event to instrument. One duration histogram per event that has a duration; its `_count` is the
event counter, so there is no second counter. Events with no duration are a plain counter.

| Event | Instrument | Labels | Ceiling of series |
|---|---|---|---|
| `http.server.request` | duration histogram, 13 bounds (16 series per label set) | `http.route`, `response.class`, `synthetic` (40 sets) | 640 |
| `app.operation` | duration histogram | `operation.type`, `response.class`, `synthetic` (80 sets) | 1,280 |
| `sync.flush` | duration histogram, plus retries histogram (6 bounds, 9 series) | `response.class`, `synthetic` (10 sets); retries by `synthetic` (2 sets) | 178 |
| `sync.queue_state_changed` | counter | `queue.state`, `synthetic` | 6 |
| `proposal.decision` | counter | `synthetic` | 2 |
| `auth.event` | counter | `response.class`, `synthetic` | 10 |
| `migration.applied` | counter | none | 1 |
| `telemetry.canary` | not exported to the backend (runtime canary only, section 3) | none | 0 |

The ceiling is the product of the closed domains, so it is a bound, not a forecast: about 2,100
series for one service, about 4,200 for both, against 10,000 on Free. Dimensions are fixed in the
mapping, not derived from whatever attributes an event happens to carry, so a future allowlist
addition cannot widen a metric by accident.

**Cardinality test (CI, required, part of T1).** Against the real SDK with an in-memory metric
reader:

1. Every entry of `ALLOWED_ATTRIBUTES` has a classification in the table above; an unclassified
   attribute fails the test, so adding an attribute forces the label decision.
2. After emitting several thousand events with random in-domain values, including random
   `duration.ms` and `retry.count`, no data point carries `duration.ms`, `retry.count` or
   `migration.version` as an attribute, and the distinct label sets per instrument never exceed the
   product of their closed domains.
3. The total series ceiling computed from the mapping stays at or under 5,000 per service pair. A
   change that raises it needs the design updated.

## 3. The allowlist and canary stay a required gate

Three layers, each a gate that fails when it cannot run:

1. **Existing unit canary** (`canary.test.ts`): sentinel content through `Telemetry.record` never
   reaches the in-memory exporter.
2. **New wire canary (CI, required).** The real `OtlpExporter` configuration exports to a local
   OTLP receiver started by the test. The test emits sentinel workout content through every
   entry point, then asserts the sentinel bytes appear nowhere in the raw request bodies, in
   headers, or in resource attributes. This is what G-5 means by "the canary passes against the
   real exporter configuration" and it needs no Grafana credentials.
3. **Runtime canary, a start-up gate that runs before any network exporter exists.** The canary
   must never touch the pipeline that can transmit, because a sentinel that reaches an exporter
   able to send has already left the process.

   Initialization is two steps, in this order:

   1. **Probe.** Build the pipeline from the production configuration, with the one difference
      that the transport is an in-memory capture (the SDK's in-memory metric and span exporters)
      instead of OTLP/HTTP. Sanitizer, event mapping, label classification, resource builder and
      fixed names are the same objects the production pipeline uses, built by the same factory
      function, which takes the transport as its only varying argument. No OTLP exporter, HTTP
      client, timer or socket has been constructed at this point. Emit the sentinel through every
      entry point and scan the captured payloads, resource and scope attributes.
   2. **Commit.** Only if the scan is clean, build the production pipeline with the real OTLP
      transport. The sentinel is never emitted into it; the probe and the production pipeline are
      separate instances.

   **Fail closed.** If the scan finds the sentinel, or the probe throws or cannot complete, the
   process installs `NoopExporter` and never constructs the OTLP transport. The decision is sticky
   for the life of the process, with no retry and no later switch to the real exporter. The health
   route reports unhealthy, so `verify-deployment` fails and the deployment is not promoted, or is
   rolled back (D-043). Nothing is transmitted in any outcome except a clean probe. Unconfigured
   (no endpoint or token) skips the probe and is plain `NoopExporter`; that is not a canary failure.

   A failed gate does not stop the process (D-7a, approved 2026-10-01): crash-looping would take
   workout logging offline over a telemetry defect, while sticky Noop plus an unhealthy health
   route already blocks promotion and leaks nothing.

   What the runtime canary does not cover: the probe stands in for everything above the transport.
   Headers, the request body encoding and anything the OTLP exporter itself adds are covered only
   by the wire canary, which is why that one is required too.

**How the wire canary proves this.** It is the same local OTLP receiver, with two cases that
the CI job requires:

- *Healthy.* The configuration exports to the receiver. Sentinels sent through every entry point
  appear nowhere in the received bodies, headers or resource attributes, and the receiver did get
  data (so the test cannot pass by exporting nothing).
- *Fault injection, no egress.* The factory takes an injectable mapper seam that is a code argument
  only (no environment variable or configuration can set it) and is used only in tests; the test installs one that deliberately copies the sentinel into a label. The test
  then asserts: start-up reports unhealthy; the receiver's request count is exactly zero, checked
  after normal events, after a forced flush, and after shutdown (which flush pending data); events
  recorded after the failed gate still produce zero requests; and the OTLP exporter class was
  never constructed (checked with a constructor spy). A pass proves the probe intercepted the
  sentinel before any production transport existed, which is the property a "failed canary
  already leaked" bug would break. Because the receiver counts every request, not only those
  containing the sentinel, a leak of unrelated data after the failure also fails the test.

The gate fails rather than skips: if the receiver cannot start or the injection seam is missing,
the job fails (OBSERVABILITY.md: a canary that cannot run is a failed gate).

Grafana-side scrubbing is not a control and is not relied on. Anything the allowlist admits is
already visible there by design.

`packages/observability/` and `.github/workflows/` are guardrail paths. Every task below that
touches them is its own PR, separate from product code (D-035).

## 4. Alert routing: two independent paths

Grafana Alerting has two sibling notification-policy routes, both `continue: true`, so a match
goes to both and neither depends on the other.

| | Path A: Telegram | Path B: Hermes |
|---|---|---|
| Contact point | Grafana Telegram integration (bot token, chat ID) | Grafana webhook with **HMAC-SHA256 signature and timestamp header** |
| Content | Custom template: alert name, severity, environment, release, runbook link. No free text | Custom JSON payload with an explicit field list: rule uid, alert name, severity, status, started-at, environment, release, runbook path |
| Secret lives in | Grafana only (bot token) | Grafana and Hermes (shared HMAC key), rotated at the same time |
| Receiver | Vladimir's phone | Narrow Hermes incident workflow. Read-only on production (D-050) |

- The payload field list is a schema in `packages/contracts`, with a test that renders the Grafana
  template against a sample alert and validates it. Labels on our alerts derive only from
  allowlisted attributes, so the payload cannot carry workout content. Grafana's default payload
  is not used, because it forwards every label and annotation.
- Hermes must reject a bad signature and a timestamp older than five minutes. That is Hermes-side
  work owned by Vladimir; the design supplies the signing spec and a test vector.
- Telegram limits a message to 4,096 characters; the template is fixed and short, with
  `parse_mode` none.

**Drills (both required before G-5 closes; each recorded with date and evidence):**

1. Path A alone: mute route B, fire a test alert, Telegram receives it within 60 s.
2. Path B alone: mute route A, fire a test alert, Hermes receives it and verifies the signature.
3. Failure isolation: point B at a URL that returns 500, confirm Telegram still arrives. Then use
   an invalid Telegram token with B healthy, confirm Hermes still receives it.
4. Negative: a payload with a wrong signature and one with a stale timestamp are rejected.

The drill workflow fires test alerts through a dedicated `drill=true` rule that routes the same way
as production rules, so the drill exercises the real policy tree.

## 5. Synthetic critical journeys

**Isolated account.** A dedicated synthetic user and data set in production, excluded from
normal views and agent recommendations (OBSERVABILITY.md). The server decides `synthetic=true`
from the authenticated identity, never from a client-supplied header, so neither spoofing nor
real traffic can move the SLO numerator.

**Two runners, one journey list.** The list follows the post-deployment verification scope in
OBSERVABILITY.md: service health, sign-in, plan loading, log a set, offline queue, sync,
proposal review, and an MCP smoke call. It lives once, next to the Playwright specs, and the k6
script covers the API-level steps of the same list.

| Runner | Cadence | Journeys | Why |
|---|---|---|---|
| Grafana Synthetic Monitoring scripted (k6) check, one EU probe | every 15 min | API-level: health, sign-in, plan load, log a set, sync round trip, MCP smoke | Independent of GitHub, native to the alert manager. 2,880 executions a month against a 100,000 free allowance. Retries once after 60 s inside the script, so a page means two failures a minute apart, and a page arrives within about 16 min of an outage |
| GitHub Actions `verify-deployment` running the existing Playwright specs | each deploy | All of the above plus the browser-only ones: offline queue, sync after reconnect, PWA install | The offline queue is a browser behaviour that changes only when code changes. Reusing Playwright avoids maintaining browser journeys twice |

Why not a 15-minute GitHub Actions cron: schedules are best effort and can be delayed or dropped,
they are switched off after 60 days without repository activity, and on a private repository the
free 2,000 minutes a month would not cover 2,880 runs. It is a bad source for an SLO that says
"at least every 15 minutes".

**Deviation to confirm (decision D-3).** OBSERVABILITY.md says the synthetic *critical journeys*
run every 15 minutes. This design runs the API-level subset on the schedule and the full set, including
browser-only journeys, on each deploy. If Vladimir wants browser journeys every 15 minutes, the
alternative is Grafana browser checks (10,000 free executions a month, which fits) at the price
of rewriting those journeys in k6 browser.

`verify-deployment` takes a deployment URL and exits non-zero on failure. G-4 wires that exit code
to rollback (D-043). One suggestion for the G-4 ADR: deploy to production without promoting, verify
the deployment URL, then promote. A failed deploy is then never live, which is safer than rolling
back after the fact.

**Synthetic credential.** Sign-in is not built (email one-time code, passkeys). A machine can't
answer either. The synthetic user therefore needs a credential that works only for that user id,
is checked server-side, and rotates. This touches authorization, so it needs its own OpenSpec
change and human approval (D-4). This design does not pick the mechanism.

## 6. Alerts

All built from metrics. D-049 requires immediate notification for four classes: security, possible
data loss, authentication, and critical-journey failure. **The alerts below cover two of them
fully or partly. They do not satisfy D-049 on their own.**

| D-049 class | Covered by this design | State |
|---|---|---|
| Critical-journey failure | Synthetic failed, synthetic silent, availability and sync fast burn | Covered, once built and drilled |
| Authentication | `auth.event` with `response.class=5xx` (server-side failure of sign-in) | **Partial.** Failed or abusive attempts and token misuse have no signal |
| Security | Nothing | **Absent.** No signal exists |
| Possible data loss | Nothing | **Absent.** No signal exists |

The two absent classes, and the missing half of authentication, are prerequisites of G-5 and are
tracked as T11 and T12 in section 10. Section 6.1 says what closes them.

| Alert | Condition | Routes |
|---|---|---|
| Synthetic journey failed | a scheduled execution fails after its in-script retry | A + B |
| Synthetic silent | no result for 30 min (NoData = alerting), covers a dead probe or dead exporter | A + B |
| Availability fast burn | 14.4x budget burn over 1 h and 5 min | A + B |
| Sync SLO fast burn | same shape, on sync latency | A + B |
| Auth failure | any `auth.event` with `response.class=5xx` in 15 min | A + B |
| Slow burn | 6x over 6 h and 30 min | B only, ticket-style |

### 6.1 Closing the D-049 gaps

The allowlist has no attribute that can say "a mutation was rejected, duplicated or lost" or "a
credential was misused". Adding one is a guardrail PR (`allowlist.ts`) plus a spec decision. This
design does not choose the signals; it makes the work explicit and blocks G-5 on it.

- **T11 (data loss).** OpenSpec change, then implementation, defining server-detectable
  possible-loss conditions and a closed outcome value for them. Candidates for the spec to accept
  or reject: an accepted mutation later missing from the sync round trip, an idempotency conflict
  or duplicate detected, a failed migration, a failed or unverified pre-migration backup (G-8; this
  one comes from the backup job, not the app, and routes through the same two paths). Existing
  coverage that is not an alert: ADR-0003, the outbox tests and the synthetic sync round trip.
- **T12 (security and authentication).** OpenSpec change, then implementation, defining security
  events (candidates: repeated failed authentication, use of a revoked or invalid MCP token,
  rejected cross-user access) and a closed outcome value. This touches authorization, so it needs
  human approval of the spec.
- Both need a new closed attribute or event, which is a guardrail PR in `packages/observability`,
  separate from product code (D-035). The metric labels stay low-cardinality: a new outcome is an
  enum, classified in the table in section 2.1 before it ships.
- Each new alert is added to the table above, routed A + B, and drilled like the others.

**G-5 cannot close while any D-049 class lacks a signal, an alert and a drill.** The only other
way to close it is a change to D-049 and OBSERVABILITY.md that narrows the promise, which is a
product-intent change and needs Vladimir's explicit approval (AGENTS.md). An agent cannot waive it,
and T10 may not mark G-5 done while T11 or T12 is open (D-7).

**Sync latency.** Client-side "60 seconds from usable connectivity" cannot be measured by the
server alone; the proposal is for the client to send its queue age (bounded integer) with each
flush and for the server to record it as a `duration.ms` histogram observation on `sync.flush`,
using the 60,000 ms bucket boundary in section 2.1. That is an app change and needs a spec (T9).

**Residual risk.** If Grafana Cloud itself is down, nothing pages. The cheap mitigation is an
external heartbeat check; it is an extra account, so it is offered as an option (D-6), not
assumed.

## 7. SLOs and the deploy pause

SLOs are those in OBSERVABILITY.md, 30-day rolling window. Two consequences of the numbers:

- **Retention conflict.** OBSERVABILITY.md says 30 days of operational telemetry and a 30-day
  window. Grafana Cloud Free keeps 14 days for metrics, logs and traces, so a 30-day budget cannot
  be computed on Free. Pro (from about 19 USD a month plus usage) is reported to keep metrics 13
  months and traces 30 days (confirm at setup). Free is enough for drills and preview; production
  needs Pro or an OBSERVABILITY.md change (D-2). Recommendation: Pro when production goes live.
- **Low volume.** One user produces maybe a few hundred critical requests a month, so a single
  failure can burn a large share of a 1 % budget. Proposal: the real-journey ratio
  (`synthetic=false`) is used only when the window has at least 300 critical-journey requests;
  below that the synthetic probe ratio is used (2,880 probes gives a budget of 28 failed probes).
  This interprets OBSERVABILITY.md and needs approval (D-5).

**Deploy pause.** A scheduled workflow (every 15 min) queries the Grafana Prometheus API with a
read-only token for remaining budget on the availability and sync SLOs, and writes the result to a
repository variable `feature-deploys-paused`. The deploy workflow's first step reads it:

- Paused: feature deploys stop. A change labelled `reliability-fix`, and rollbacks, still deploy.
- Query fails or the data is stale by more than one hour: **fail closed** for feature deploys, and
  say why in the job summary. Only Vladimir can override it.
- The lost-or-duplicated objective has no budget and no pause rule; a violation is an incident.

The deploy gate is a guardrail change (workflow files), shipped alone.

## 8. Monthly cost

| Item | Now (dev, preview, drills) | Production |
|---|---|---|
| Grafana Cloud | 0 USD (Free: 10k series, 50 GB logs and traces, 14-day retention, 3 users) | About 19 USD base plus usage. Expect usage near zero at this volume: tens to hundreds of series, no logs, small traces. Free allowances on Pro are not confirmed |
| Synthetic Monitoring | 0 USD (2,880 executions against 100k free) | Same; confirm allowance on Pro |
| Telegram bot | 0 | 0 |
| Hermes webhook | Existing | Existing |
| GitHub Actions | 0 on a public repo. Private: about 60 to 100 minutes for deploy checks, within 2,000 free | Same |
| **Total** | **0** | **About 19 to 25 USD, roughly 190 to 250 SEK at 10 SEK per USD** |

That is well under 1 % of the 50,000 SEK a month target. It is a ceiling estimate for a design
that has not been run; the first month's invoice replaces it.

## 9. What Vladimir must decide or provide

**Decisions**

- **D-1** (approved 2026-10-01) Approve Grafana Cloud as the provider (stays provisional until the drills pass).
- **D-2** (approved: Pro at go-live) Production needs Pro (about 19 USD a month), or change the 30-day retention and window
  in OBSERVABILITY.md. Recommendation: Pro at production go-live.
- **D-3** (approved: recommended option) API-level journeys every 15 minutes and the full set on deploy (recommended), or browser
  journeys every 15 minutes via k6 browser (more rewriting). The subset is a deviation from
  OBSERVABILITY.md; until Vladimir approves it, it does not satisfy the "every 15 minutes" SLO row
  and G-5 cannot close on it.
- **D-4** (approved) Approve an OpenSpec change for the synthetic user: how it authenticates, how it is
  excluded from views and recommendations, and how `synthetic=true` is set server-side.
- **D-5** (approved) Approve the low-volume rule for the error budget (300-request floor, then probes).
- **D-6** (declined, no external heartbeat for now) Optional: an external heartbeat monitor for the "Grafana is down" case.
- **D-7** (approved 2026-10-01, both recommendations) (a) A failed runtime canary leaves telemetry off and the health
  route unhealthy but does not stop the process. (b) G-5 stays open until T11 and T12 ship with
  drilled alerts; no narrowing of D-049 or OBSERVABILITY.md is proposed.

**Accounts and credentials (none exist; none requested until phase 2 starts)**

1. Grafana Cloud stack: Free now, Pro at go-live. Stack region in the EU. Two tokens: an OTLP
   write token, and a read-only token for the budget query. A service account for alert
   provisioning. Separate stacks or tokens for preview and production.
2. Telegram bot from BotFather and the chat ID for Vladimir's chat.
3. Hermes: the incident webhook URL and a shared HMAC key, and Hermes-side signature and
   timestamp checks.
4. The synthetic user credential, after D-4.
5. GitHub repository variable and secrets for the deploy pause and `verify-deployment`. These sit
   with G-1 and G-9 and need scoped credentials, not the owner token.

## 10. Implementation task breakdown (proposal for the Chief of staff)

Each code task gets the usual review, QA and merge children. Guardrail tasks are their own PRs.

| # | Task | Owner | Needs | Guardrail PR |
|---|---|---|---|---|
| T1 | `OtlpExporter` in `packages/observability` with an explicit resource, fixed names and the label classification (2.1); cardinality test; wire canary with the healthy and zero-egress fault-injection cases; two-step probe-then-commit start-up gate and health route hook (3) | Software Engineer | Nothing external | Yes (the package) |
| T2 | Wire `Telemetry` into `apps/web` and `apps/mcp` at start-up; record the closed events on real routes and operations | Software Engineer | T1 | No (product) |
| T3 | Alert-as-code: rules, notification policy (two sibling routes), contact points, Telegram and webhook templates, payload schema in `packages/contracts`. Evaluate the Grafana Terraform provider against `grafanactl` and use the maintained one; do not write a client | Platform & Reliability | Grafana stack, tokens (D-1) | Partly (workflow) |
| T4 | Alert drills 1 to 4 against a **non-production** Grafana stack; record results in `docs/runbooks/alert-drill.md` | Platform & Reliability, signed off by QA | T3, Telegram bot, Hermes URL and key | No |
| T5 | OpenSpec change for the synthetic user (D-4), then the implementation | Product/spec agent, then Software Engineer | D-4 | No |
| T6 | k6 scripted check for the 15-minute journeys and its alert rules | Platform & Reliability | T5, Grafana stack | No |
| T7 | `verify-deployment` workflow around the Playwright journey specs, taking a URL | Platform & Reliability | T5, G-4 ADR | Yes (workflow) |
| T8 | SLO recording rules, budget query, `feature-deploys-paused` variable and the deploy-workflow check | Platform & Reliability | T3, Pro decision (D-2, D-5) | Yes (workflow) |
| T9 | Client queue age on `sync.flush` (spec, then code) | Product/spec agent, Software Engineer | D-4-style approval | Yes if the allowlist changes |
| T11 | Possible-data-loss signal (6.1): OpenSpec change, allowlist change, instrumentation, alert rule, drill | Product/spec agent, then Software Engineer, Platform & Reliability | Spec approval; allowlist change is its own PR; alert and drill need T3 | Yes if the allowlist changes |
| T12 | Security and authentication signals (6.1): OpenSpec change (touches authorization), allowlist change, instrumentation, alert rules, drill | Product/spec agent, then Software Engineer, Platform & Reliability | Human approval of the spec; T3 for the alert | Yes if the allowlist changes |
| T10 | Close G-5: run drills against the production stack and recheck cost against the first invoice. **Blocked by T11 and T12** (D-7b) | Platform & Reliability | Production credentials from Vladimir (G-9) | No |

Suggested order: T1, T3, T5, T11 and T12 specs in parallel; then T2, T4, T6; then T7, T8, T9 and the
T11/T12 implementations; T10 last.
T1 and T2 need no account and can start now. T3 and T4 need a Free Grafana stack, a Telegram bot
and the Hermes endpoint, which only Vladimir can create (D-1, section 9); they stay blocked until then.

## 11. What this design does not verify

Nothing was run. Grafana free-tier figures come from Grafana's pricing page; Pro retention and
the Pro synthetic allowance came from third-party summaries and must be confirmed at setup. No
Telegram or webhook delivery, no OTLP export and no synthetic run has happened. The series
ceilings in section 2.1 are arithmetic on the allowlist domains, not measured. The probe-then-commit
gate and its zero-egress test are specified, not built. G-5 stays open, and stays open while the
D-049 security and data-loss signals (T11, T12) do not exist.
