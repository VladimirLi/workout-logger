# Agentic Workout Project — Discovery Decision Record

**Status:** Working draft; pre-project discovery evidence  
**Captured:** 2026-09-15 20:36 CEST  
**Purpose:** Preserve accepted and provisional Grill Me decisions until the project repository is created. This file is not yet the normative product specification.

## Status vocabulary

- **Accepted:** Explicitly selected during the Grill Me session.
- **Provisional:** Direction is accepted, but implementation details remain unresolved.
- **Open:** Requires a later decision.

## 1. Product direction

### D-001 — Initial product maturity
**Status:** Accepted

The product idea is exploratory. The first phase will build a narrow prototype to learn through use.

### D-002 — Prototype standard
**Status:** Accepted

The prototype will be a production-shaped vertical slice rather than disposable prototype code.

### D-003 — Target user and problem
**Status:** Accepted

The initial target user is Vladimir. The product is a gym workout logging application with AI-agent integration. An authorized external agent should be able to manage the workout plan based on goals and completed sessions, subject to user approval of changes.

### D-004 — Initial vertical-slice outcome
**Status:** Accepted

The user can follow a workout plan and log a session. An external AI agent can read the relevant data and propose modifications.

## 2. Product governance and traceability

### D-005 — Human–agent authority model
**Status:** Accepted

The human approves product intent. Agents own implementation and execution within defined deterministic gates. Human approval is not required for normal implementation changes after intent has been approved.

### D-006 — Normative source of truth
**Status:** Accepted

Normative product intent will live in version-controlled repository documents and specifications.

### D-007 — Specification lifecycle
**Status:** Accepted

OpenSpec will provide the primary change lifecycle for normative product and architecture changes.

### D-008 — Roadmap model
**Status:** Accepted

The roadmap will describe outcomes with evidence gates rather than a committed feature list.

### D-009 — OpenSpec classification
**Status:** Accepted

Agents will classify whether a change requires an OpenSpec proposal. Policy rules and an independent reviewer must verify the classification. The implementing agent's classification alone is not authoritative.

### D-010 — Change traceability
**Status:** Accepted

Changes will use conventional commits and mandatory pull-request metadata to link product or maintenance intent, implementation, tests, review, and release evidence.

## 3. Workout domain

### D-011 — Initial plan model
**Status:** Accepted

The first slice will support one active plan containing scheduled workout sessions.

### D-012 — Exercise records
**Status:** Accepted

Completed exercises should support sets, repetitions, load, RPE or RIR, and notes where applicable.

### D-013 — Measurement profiles
**Status:** Accepted

The domain will use a small, explicit set of typed exercise measurement profiles. It must accommodate at least:

- conventional strength exercises;
- unilateral exercises with separate left and right results;
- cardio activities such as treadmill work, including applicable duration, distance, pace, or incline measurements.

Not every field applies to every profile.

### D-014 — Extending measurement profiles
**Status:** Accepted

New measurement profiles will be introduced through ordinary versioned code and schema changes with validation, migrations, UI support, and tests. The first slice will not introduce plugins or user-defined schemas.

### D-015 — Completed-session history
**Status:** Accepted

Synchronized completed workout facts are immutable. Corrections create audited revisions rather than silently rewriting history.

## 4. Agent integration and proposals

### D-016 — Agent write authority
**Status:** Accepted

External agents cannot directly mutate authoritative product data. Every MCP write operation creates a proposal. Reads are immediate for an authenticated client.

### D-017 — Proposal evidence
**Status:** Accepted

Each proposal must contain:

- the base revision snapshot;
- a structured diff;
- the agent's rationale.

The user approves or rejects the proposal before it becomes authoritative.

### D-018 — Stale proposals
**Status:** Accepted

If the authoritative base revision changes, the proposal is rejected as stale and must be regenerated. The system will not silently rebase it.

### D-019 — MCP transport and authentication
**Status:** Accepted

MCP will be exposed over HTTPS and use a credential separate from browser identity.

### D-020 — Initial MCP authorization granularity
**Status:** Accepted

The first slice will use one revocable full-access token supporting immediate reads and proposal creation. Fine-grained operation scopes are deferred.

## 5. User experience and offline operation

### D-021 — Primary product surface
**Status:** Accepted

The product will be an installable, phone-first PWA plus an MCP server for external agents.

### D-022 — Offline contract
**Status:** Accepted

Core logging works offline. The phone can access previously downloaded plan data and record a session without connectivity. Entries are durably queued and synchronized when connectivity returns. Agent reads and proposals wait until authoritative server data is synchronized.

The first slice does not support general concurrent offline editing with automatic conflict reconciliation.

### D-023 — Deployment reachability
**Status:** Accepted

The PWA will be privately hosted over HTTPS and reachable from the phone at the gym. “Private” means authenticated and single-user rather than local-device-only. MCP has a separate access boundary.

### D-024 — Web authentication
**Status:** Accepted

The PWA will use managed passkey or passwordless authentication rather than application-managed passwords.

## 6. Architecture and platform

### D-025 — Persistence platform
**Status:** Accepted for the first slice

Use Supabase Pro as the initial managed Postgres and authentication platform, subject to a short setup-time check that no blocking requirement has emerged. Keep Supabase-specific behavior behind provider adapters and contract tests as defined by D-026. Application hosting remains a separate deployment choice.

### D-026 — Provider portability
**Status:** Accepted

The domain and repository boundaries must remain provider-neutral. Provider-specific capabilities may be used through replaceable adapters with contract tests. The first slice will not maintain two working provider implementations.

### D-027 — Language
**Status:** Accepted

Use TypeScript end to end.

### D-028 — Application topology
**Status:** Accepted

Use a modular monolith with shared domain and application packages. The domain must not depend on Next.js, Supabase, MCP, or presentation concerns.

### D-029 — Framework shape
**Status:** Accepted

Use a Next.js PWA with server routes and a separate MCP entry point.

### D-030 — Repository shape
**Status:** Accepted

Use one monorepo containing independently deployable applications and shared packages.

### D-031 — Architecture enforcement
**Status:** Accepted

Machine-enforce domain-to-adapter dependency direction and circular-dependency checks.

## 7. Deterministic quality controls

### D-032 — Enforcement authority
**Status:** Accepted

CI is authoritative. Local hooks provide fast feedback but never replace protected CI.

### D-033 — Merge policy
**Status:** Accepted

Every applicable required gate must pass before merge.

### D-034 — Implementation review
**Status:** Accepted

A normal implementation change requires all deterministic gates and approval from one independent agent reviewer. It does not require human implementation approval.

### D-035 — Guardrail self-modification
**Status:** Accepted

An implementing agent may not modify the required gates evaluating that implementation in the same change.

### D-036 — Guardrail maintenance
**Status:** Accepted

Legitimate guardrail changes must be submitted separately and reviewed by an independent agent under the existing gates.

### D-037 — Initial deterministic gate
**Status:** Accepted

The required gate will cover, where applicable:

- formatting;
- linting;
- static types;
- unit and domain tests;
- integration tests;
- critical-path end-to-end tests;
- production build verification;
- architecture dependency rules and cycle detection;
- dependency vulnerability and license checks;
- secret scanning;
- security analysis;
- migration validation;
- accessibility checks.

### D-038 — Test coverage strategy
**Status:** Accepted

Prioritize high behavioral coverage of domain and application logic, plus critical-path integration and E2E coverage. Do not use one blunt global coverage percentage as the primary quality definition.

### D-039 — Dependency failure policy
**Status:** Accepted

Block high or critical runtime vulnerabilities and prohibited licenses.

### D-040 — Dependency maintenance
**Status:** Accepted

Use automated dependency pull requests. They must pass the complete applicable gate suite and receive independent review.

## 8. Releases, deployment, and recovery

### D-041 — Release identity
**Status:** Accepted

Use semantic versioning, automated changelogs, and deployment provenance tied to exact source and verification evidence.

### D-042 — Delivery model
**Status:** Accepted

Every merged change deploys automatically to production.

### D-043 — Failed deployment behavior
**Status:** Accepted

Failed post-deployment health or synthetic verification triggers automatic rollback.

### D-044 — Database migration policy
**Status:** Accepted

Production migrations require:

- a backup before migration;
- expand-contract compatibility;
- a verified restoration path.

### D-045 — Production verification
**Status:** Accepted

Post-deployment verification covers:

- service health;
- authentication;
- plan loading;
- offline queue behavior;
- synchronization;
- proposal review;
- MCP smoke tests.

### D-046 — Synthetic data isolation
**Status:** Accepted

Production synthetic checks use isolated synthetic account/data excluded from normal views and from agent recommendations.

## 9. Observability, privacy, and incidents

### D-047 — Operational telemetry content
**Status:** Accepted

Production logs, metrics, and traces retain structured metadata only. They must not contain workout content or agent rationale by default.

### D-048 — Audit retention
**Status:** Accepted

Proposal artifacts, audit events, and revision history remain until explicitly deleted by the user.

### D-049 — Immediate alerts
**Status:** Accepted

Notify the user immediately for security, possible data-loss, authentication, or critical-journey failures.

### D-050 — Incident-agent authority
**Status:** Accepted

An incident-response agent may inspect evidence, diagnose, and open a tested fix pull request. It may not directly mutate production. Deterministic deployment automation may still perform the configured automatic rollback.

## 10. Research-derived requirements

The following requirements resolve implementation-level questions using current primary specifications and conservative project defaults. They are **proposed** until the discovery record is promoted into the project repository.

### Product learning and feedback

#### R-001 — First-slice evidence
**Status:** Proposed default

The first slice shall measure whether the user can reliably complete the intended loop, not generic growth metrics. Record only privacy-safe events sufficient to derive:

- planned workouts started and completed;
- sessions completed without data loss;
- offline entries eventually synchronized;
- proposals reviewed, accepted, rejected, or rejected as stale;
- time and recoverable errors along each critical journey.

The initial evidence gate is four real workouts across at least two weeks, including one deliberately offline session and one agent proposal. The gate passes only if no workout facts are lost or duplicated and the user can complete each journey without developer intervention. Outcome thresholds may be tightened after baseline evidence exists.

#### R-002 — Roadmap feedback
**Status:** Proposed default

Each roadmap outcome shall name its hypothesis, observable evidence, review date, and decision rule. Usage evidence, incidents, and direct user observations enter a monthly review as evidence; they do not automatically modify normative requirements. Any product-behavior change still follows the OpenSpec classification policy.

### Workout and mobile experience

#### R-003 — Core journey states
**Status:** Proposed default

Provide separately addressable plan, active-workout, and completed-summary states. Refresh, navigation, app suspension, and process termination must not lose an active session. Only one active session may exist per user device; a second start offers resume or discard.

#### R-004 — In-workout interaction
**Status:** Proposed default

On a 375 × 667 CSS-pixel viewport, the current exercise, current target versus actual result, sync state, and primary log action shall be usable without horizontal scrolling. Accepting an unchanged prescribed set should require one primary action. Rest timers derive elapsed time from timestamps so background suspension does not create drift.

#### R-005 — Typed measurements and units
**Status:** Proposed default

Every quantity is stored as a typed value with a unit, never as an unlabelled number. Canonical storage units are kilograms, metres, seconds, kilocalories, watts, revolutions or strokes per minute, and beats per minute. Display conversions never overwrite canonical values. Strength, unilateral strength, and cardio are separate discriminated profiles with schema-versioned validation.

Unilateral records store side (`left`, `right`, `both`, or `alternating`) and load semantics (`per_side` or `total`) explicitly. Left and right observations remain distinct in storage.

#### R-006 — Perceived exertion
**Status:** Proposed default

Strength-set exertion uses RIR as the authoritative user-entered value; the corresponding 1–10 RPE is derived and read-only. Half-step precision is allowed where the mapping supports it. Cardio exertion uses a separately tagged Borg scale and never shares an untyped field with strength exertion. Session-level exertion, if captured, is distinct and is not calculated by averaging set values.

#### R-007 — Accessibility and visual verification
**Status:** Proposed default

Target WCAG 2.2 Level AA. Primary in-workout controls should also meet the stronger 44 × 44 CSS-pixel target because gym use is one-handed and motion-prone. Required verification includes automated accessibility checks plus manual keyboard, screen-reader, zoom, orientation, contrast, and touch-target checks. Automated scans alone cannot establish conformance.

Visual regression covers plan, active set, rest state, completion summary, proposal review, and all offline/synchronization failure states at representative small and large phone viewports, light/dark themes, and 200% text. Fixtures pin time, data, fonts, browser, and animations.

### Offline durability and synchronization

#### R-008 — Transactional outbox
**Status:** Proposed default

Each offline mutation and its outbox item shall be written atomically to IndexedDB. Every logical operation receives a stable client-generated UUID/idempotency key that is preserved across retries and cannot be reused for a different payload. The server stores the key and original result transactionally with the accepted mutation, so replay cannot duplicate a set or correction.

#### R-009 — Queue ordering and retry
**Status:** Proposed default

Drain mutations in order per entity. Use capped exponential backoff with full jitter; honor a longer `Retry-After` response. Network errors, 408, 429, and 5xx are retryable. Other 4xx responses become permanent failures requiring attention. Background Sync may improve delivery but cannot be the only flush mechanism because it is unavailable in Safari and Firefox; also flush on foreground, connectivity restoration, authentication refresh, and explicit user action.

#### R-010 — Offline failure UX
**Status:** Proposed default

Expose three stable states: `saved on device`, `syncing`, and `needs attention`. Never discard a queued workout mutation automatically. Quota exhaustion stops new writes with a clear recovery action. Attempt persistent browser storage and show its granted/denied state in diagnostics. Provide an export of unsynchronized records before any destructive recovery action.

### Managed platform, identity, and data protection

#### R-011 — Backend baseline
**Status:** Proposed default

Use Supabase Pro as the initial managed Postgres/auth platform unless a pre-build comparison finds a blocking requirement. Free-tier pausing is unsuitable for the production instance. Keep domain and application contracts provider-owned; place Supabase queries, Auth, RLS, and deployment behavior behind adapters with contract tests.

#### R-012 — Authentication
**Status:** Proposed default

Use email OTP/passwordless authentication as the guaranteed recovery path and Supabase passkeys as an optional daily sign-in convenience until Supabase marks passkey support stable. Select the production apex domain before enrolling passkeys because changing the WebAuthn relying-party ID invalidates enrolled credentials. Never enroll production credentials against a provider preview domain.

#### R-013 — Database authorization
**Status:** Proposed default

Enable RLS and explicit grants on every table or view reachable through an exposed schema. Tests must prove deny-by-default behavior for unauthenticated and wrong-user identities for every operation. Service-role credentials stay server-side and must not appear in browser bundles, service-worker caches, logs, or traces. Index columns used by RLS policies and safely pin `search_path` in any security-definer function.

#### R-014 — Export and deletion
**Status:** Proposed default

Provide a one-action full JSON export and human-readable CSV exports for workout history. JSON must be versioned and round-trip importable into a clean compatible instance. Deletion uses a 30-day recoverable period followed by verified hard deletion; the UI explains when expired backup generations cease to contain the deleted data.

#### R-015 — Private-slice recovery policy
**Status:** Accepted risk boundary

While Vladimir is the sole user, do not pay for PITR or run scheduled backups. Before every production migration, create an encrypted logical Postgres dump, store it outside the application provider, verify that it is readable, record its checksum against the release, and fail closed before migration if any step fails. Periodically drill restoration of a retained dump into an isolated project. This protects migration recovery only; complete loss of data created between migrations is explicitly accepted. Define scheduled backups, numeric RPO/RTO, and retention before onboarding any external user. Media storage, if later introduced, requires a separate backup path because database backups do not include storage objects.

### Migrations and deployment

#### R-016 — Migration compatibility
**Status:** Proposed default

Use expand → migrate → contract across separate releases. Non-concurrent DDL runs transactionally. Potentially blocking migrations set short lock and statement timeouts and fail rather than queue application traffic. Contract migrations occur only after telemetry proves the old application/schema path is unused.

#### R-017 — Backup and rollback sequence
**Status:** Proposed default

Before a production migration, create and identify an on-demand backup/export tied to the release. Deploy the backward-compatible expansion, migrate data, deploy the application, and run synthetic verification. On application failure, roll the application back while retaining the compatible expanded schema. Do not use automatic down-migrations; recover destructive data errors through a reviewed forward fix or verified restore.

### Observability and service objectives

#### R-018 — Telemetry implementation
**Status:** Proposed default

Use OpenTelemetry stable trace and metric APIs and stable HTTP semantic conventions. Treat browser instrumentation and the OpenTelemetry JavaScript logs API as unstable; pin versions and do not make them the sole alert source. Server instrumentation starts before application modules load.

An allowlisting processor shall permit only low-cardinality operational metadata such as service/version, environment, route template, operation type, response class, duration, retry count, queue state, migration version, and synthetic marker. It shall drop unknown attributes. URLs, headers, query strings, tokens, exercise names, notes, weights, repetitions, body data, rationales, and free text are forbidden. A CI/runtime canary test must prove sentinel workout content never reaches exported telemetry.

#### R-019 — Initial SLOs
**Status:** Proposed default

Use a 30-day rolling window:

- critical authenticated journeys succeed ≥ 99.0%;
- a queued workout mutation synchronizes within 60 seconds of usable connectivity ≥ 99.5%;
- no accepted mutation is lost or duplicated;
- production synthetic critical journeys pass on each deployment and at least every 15 minutes.

Exhausting the availability or synchronization error budget pauses feature deployment until reliability is restored. Retain operational telemetry for 30 days initially.

### MCP contract and security

#### R-020 — Remote MCP authorization
**Status:** Proposed default; refines D-019 and D-020

Implement the remote HTTP MCP server as an OAuth-protected resource following the current MCP authorization specification, including protected-resource metadata, authorization-server discovery, HTTPS, audience validation, exact redirect matching, PKCE where applicable, and no token passthrough. “One token” means one revocable client authorization, not a wildcard or non-expiring bearer secret. Grant explicit `workout:read` and `proposal:create` scopes together initially while retaining separate server-side enforcement.

Access tokens expire within 15 minutes. Refresh credentials are rotated, encrypted in a managed secret store, and revocable with propagation within five minutes. Tokens never appear in URLs, logs, repository files, browser storage, or process arguments.

#### R-021 — Initial MCP surface
**Status:** Proposed default

Expose read resources/tools for product capabilities, active-plan revision, scheduled sessions, completed-session summaries, exercise definitions, and proposal status. Expose proposal tools for plan replacement, scheduled-session changes, exercise-prescription changes, and completed-session corrections. Do not expose a generic SQL/query tool, arbitrary patch operation, direct delete, deployment, credential, or administration tool.

All schemas are closed and versioned, reject unknown fields, validate bounds, cap result size, paginate history, and rate-limit calls. Tool outputs are treated as untrusted data by clients. Each invocation is re-authorized. Proposal records include proposal ID, authenticated actor/client, target revision, canonical structured diff, rationale, creation/expiry timestamps, and input hash.

### UX and product design lifecycle

#### R-022 — Design evidence
**Status:** Proposed default

For each product-affecting OpenSpec change, maintain: journey/problem statement, acceptance scenarios, interaction states including empty/loading/offline/error states, accessible component behavior, and a reviewable prototype or exact-node design when visual behavior is material. Design is not accepted solely through an agent critique; critical journeys require direct use by the target user before the outcome is marked validated.

### Agent-driven delivery

#### R-023 — Role separation
**Status:** Proposed default

Use separate identities and least-privilege credentials for:

- product/specification agent: drafts but cannot approve product intent;
- implementation agent: writes a branch/PR but cannot approve or merge it;
- independent review agent: reads candidate source and evidence, has no write credential, and issues a structured verdict;
- CI gatekeeper: executes deterministic checks and publishes an immutable required result;
- release automation: deploys only an attested merge commit through short-lived OIDC credentials;
- incident agent: reads sanitized evidence and opens fix PRs, with no production mutation rights.

No principal may both implement a candidate and attest its independent review or CI result.

#### R-024 — Agent execution isolation and provenance
**Status:** Proposed default

Agent runs execute in ephemeral isolated workspaces with no production credentials and default-denied network access except declared endpoints. Record run ID, role, model/version, prompt/spec hash, tool names, source and candidate commit, start/end time, token/cost totals, evidence artifacts, and outcome. Do not retain hidden reasoning, secrets, user content, or raw tool payloads. Retain provenance metadata for 90 days and release-linked attestations for the life of the release.

Set runner-enforced per-run limits initially to 30 minutes and 200,000 tokens; checkpoint and mark the task blocked rather than allowing silent overrun. Cost limits are configuration, not prompt instructions.

#### R-025 — Independent review and autonomous merge
**Status:** Proposed default; preserves D-034

The reviewer must use a separate invocation and credential, receive the accepted specification, exact candidate SHA, diff, tests, and required evidence, but not the implementation agent's private reasoning. Any new commit invalidates the verdict. A machine-readable approval bound to the exact SHA becomes a required status check. The merge service may merge only when that approval and every deterministic gate are green. High/critical findings block; waivers require human approval and a durable rationale. Product-intent, guardrail, credential, ruleset, and production-access changes remain subject to their separately defined governance.

#### R-026 — GitHub protection and provenance
**Status:** Proposed default

Protect the default branch with an active ruleset: pull requests only, required checks from named trusted sources, stale review dismissal, linear history, signed commits, no force-push or deletion, and no routine bypass actor. Pin third-party Actions to full commit SHAs. Generate artifact attestations for each release and verify the attestation before deployment. Target SLSA Build Level 2 for the first release; treat Level 3 reusable-workflow isolation as a later hardening outcome unless risk changes.

### Repository structure and developer contract

#### R-027 — Monorepo boundaries
**Status:** Proposed default

Use this logical structure without adding empty extension layers:

```text
apps/web                 Next.js PWA and server-route adapter
apps/mcp                 remote MCP transport adapter
packages/domain          entities, value objects, invariant rules
packages/application     use cases and provider-neutral ports
packages/contracts       versioned API/MCP schemas and generated types
packages/adapters-supabase
packages/observability   approved telemetry API and allowlist
packages/test-support    synthetic builders and adapter contract suites
openspec/                normative change artifacts
```

Dependencies flow `apps/adapters → application → domain`; contracts may depend only on schema/value libraries; domain depends on no framework or I/O package. Every package declares explicit Node `exports`; cross-package deep imports are forbidden. TypeScript project references and automated graph checks enforce an acyclic build.

#### R-028 — Canonical commands and bootstrap
**Status:** Proposed default

Pin the Node and package-manager versions and commit the lockfile. Root commands are the only CI interface: `install`, `dev`, `format`, `format:check`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `test:a11y`, `test:architecture`, `build`, and `verify`. `verify` runs every required non-deployment gate. A clean, documented bootstrap must execute `install && verify` successfully without undeclared global tools or machine state. CI verifies this in a clean container.

### Licenses and software supply chain

#### R-029 — License policy
**Status:** Proposed default

Allow without exception: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, BlueOak-1.0.0, Python-2.0, and Unlicense. Reject AGPL, SSPL, BUSL, Commons Clause, Elastic License 2.0, non-commercial licenses, the JSON license, and unresolved/unknown licenses in distributed runtime dependencies. LGPL, MPL, EPL, CDDL, GPL, and dual-license expressions require review based on actual linkage and distribution. Dev-only tooling is evaluated separately from shipped/runtime code.

Every exception records component/version, SPDX expression, use and linkage, lack of alternative, obligations, approver, and review date no more than 12 months away. Generate an SPDX or CycloneDX SBOM and signed provenance for every release.

## Assumptions retained

1. “Single-user” permits an isolated synthetic identity for production verification and uses `user_id` ownership internally so future evolution does not require rewriting the domain.
2. Agent rationale is authoritative proposal data, not operational telemetry.
3. Human approval of product intent precedes implementation of product-affecting OpenSpec changes.
4. Security-sensitive or irreversible operations remain human-controlled even though normal implementation is autonomous.
5. Progress photos, body measurements, Apple Health, and Health Connect are excluded from the first slice unless explicitly added later.
6. Automatic deletion of unsynchronized workout records is prohibited.

## Product-owner decisions resolved after research

The decisions below materially altered user meaning, legal/cost exposure, or a one-way door and were therefore confirmed explicitly:

1. ~~Initial programming scope: scheduled workout sessions only, or a multi-week periodized programme with progression rules.~~ **Resolved: scheduled workout sessions only for the first slice.** Progression remains an external-agent decision expressed through proposals; programme phases and encoded progression rules are deferred.
2. ~~Default interpretation of unilateral load: per side or combined total.~~ **Resolved: per side.** A unilateral load value defaults to the load used by each side; the record still stores load semantics explicitly and permits a per-exercise override.
3. ~~Primary display units: metric or imperial.~~ **Resolved: metric.** Default to kg, km, and min/km while retaining canonical typed storage and explicit future display conversion.
4. ~~Strength exertion UX: show RPE, RIR, both, or neither by default.~~ **Resolved: show RIR by default and derive RPE.** RIR is the authoritative user entry for strength sets; the mapped RPE is read-only/derived.
5. ~~Production apex domain, required before passkey enrollment.~~ **Resolved: `gym.vladimirli.com`.** Use `vladimirli.com` as the WebAuthn relying-party ID only if the final origin policy intentionally allows sibling subdomains; otherwise bind the RP ID to `gym.vladimirli.com`. Confirm DNS and origin configuration before enrolling production passkeys.
6. ~~Whether losing up to 24 hours of server-side data is acceptable or paid PITR is required.~~ **Resolved for the private first slice: no paid PITR and no scheduled backup.** Before every production migration, create an encrypted logical Postgres dump, store it outside the application provider, verify that it is readable, record its checksum against the release, and fail closed before migration if any step fails. Retain recent pre-migration dumps. This protects migration rollback only; complete loss of data created between migrations is explicitly accepted while Vladimir is the sole user. Revisit scheduled backups and RPO/RTO before onboarding any external user.
7. ~~Whether single-user is a permanent product boundary or only the first release boundary.~~ **Resolved: single-user is only the first-release boundary.** Keep ownership, RLS, exports, and audit identity multi-user-safe without implementing multi-user product features yet.
8. ~~Whether progress photos or body measurements belong in the first product horizon.~~ **Resolved: exclude both.** Do not add media storage or body-measurement data to the first product horizon.
9. ~~Whether deletion should have the proposed 30-day recovery period or be immediate.~~ **Resolved: 30-day recoverable deletion, then verified hard deletion.** Backup copies expire according to the documented backup-retention schedule.
10. ~~Whether source code may be sent to approved third-party model providers; production secrets and workout data remain prohibited regardless.~~ **Resolved: source code may be sent to approved third-party model providers.** Provider approval and runner controls are required; production secrets, credentials, personal workout data, and raw production evidence remain prohibited.
11. ~~Notification channel for immediate production alerts.~~ **Resolved: dual-path external alerting.** An independent alert manager sends primary human notifications directly to Telegram and independently sends a signed, metadata-only webhook to a narrowly scoped Hermes incident workflow. Hermes is not in the paging critical path; either delivery path can fail without suppressing the other. Hermes may diagnose and open a tested fix PR but cannot mutate production. Grafana Cloud Alerting is the provisional provider because it supports both Telegram contact points and generic webhooks; confirm pricing and operational fit during setup.

## Research basis

Primary references consulted:

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [mobile application guidance](https://www.w3.org/TR/wcag2mobile-22/)
- [Web App Manifest](https://www.w3.org/TR/appmanifest/)
- [MDN Background Synchronization API compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [MDN storage persistence](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)
- [HTTP Idempotency-Key draft](https://datatracker.ietf.org/doc/html/draft-ietf-httpapi-idempotency-key-header-07)
- [Web Vitals](https://web.dev/articles/vitals)
- [Supabase passkeys](https://supabase.com/docs/guides/auth/passkeys), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), and [backups](https://supabase.com/docs/guides/platform/backups)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [function security](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY), and [concurrent indexes](https://www.postgresql.org/docs/current/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY)
- [OpenTelemetry HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/) and [JavaScript implementation status](https://opentelemetry.io/docs/languages/js/)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Google SRE Workbook: Implementing SLOs](https://sre.google/workbook/implementing-slos/)
- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization), [security guidance](https://modelcontextprotocol.io/specification/latest/basic/security_best_practices), and [tools](https://modelcontextprotocol.io/specification/latest/server/tools)
- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) and [Protected Resource Metadata, RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html)
- [GitHub repository rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets) and [artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating)
- [SLSA build requirements](https://slsa.dev/spec/v1.2/build-requirements)
- [NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final)
- [Node package exports](https://nodejs.org/api/packages.html#exports) and [TypeScript project references](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [SPDX license list](https://spdx.org/licenses/) and [OpenChain ISO/IEC 5230](https://www.openchainproject.org/license-compliance)

## Intended disposition

When the project repository is created, review this draft and split accepted decisions into the appropriate normative artifacts, likely including:

- `VISION.md`;
- `ROADMAP.md`;
- `AGENTS.md`;
- architecture and engineering policies;
- security and observability policies;
- OpenSpec project configuration and approved changes;
- narrowly scoped architecture decision records where needed.

Do not copy this draft wholesale into the repository without reconciling its provisional assumptions and open decisions.
