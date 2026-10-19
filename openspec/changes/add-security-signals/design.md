## Context

D-049 wants an immediate notification for security and authentication failures. Today the
allowlist can say that a sign-in failed server-side (`auth.event`, `response.class=5xx`) and nothing
about a credential being refused.

Facts that decide what is observable (read from the repository on 2026-10-19):

- **Web sign-in is browser to Supabase Auth.** `apps/web` has no route handler. Email-code request
  and verification are made by the device against Supabase Auth
  (`packages/adapters-supabase/src/email-auth.ts`, `apps/web/app/device.ts`). A refused code is
  returned to the browser and is never seen by a process we run.
- **Supabase Auth hooks do not cover a refused code.** The public hooks page lists Before User
  Created, Custom Access Token, Send SMS, Send Email, MFA Verification Attempt and Password
  Verification Attempt. None is invoked when an email one-time code is refused. (Read 2026-10-19;
  not exercised against a project.)
- **The MCP server is the only process that sees an MCP token.** It is the resource server; Supabase
  Auth is the authorization server (ADR-0013). `authorizeInvocation`
  (`apps/mcp/src/authorization.ts`) already returns a typed failure per invocation:
  `invalid_validity_window`, `lifetime_too_long`, `token_not_yet_valid`, `token_expired`,
  `audience_mismatch`, `missing_scope`, `unknown_tool`. The transport that verifies signature and
  revocation does not exist yet; the MCP server is a skeleton (`apps/mcp/src/server.ts`).
- **The synthetic exchange is a server route** (`add-synthetic-user`, not yet approved or built). It
  receives a credential, compares digests, and refuses or issues a token. It is the one place where
  our own code refuses a presented authentication secret. That spec reserves nothing for failures
  and leaves them to this change.
- **Writes carry no user id.** Every write is a `SECURITY DEFINER` function that takes the user from
  `auth.uid()` (ADR-0012 I-1). Reads are filtered by forced row level security (I-3). A user holds
  `SELECT` on their own rows and `EXECUTE` on the boundary functions, nothing else (I-2, I-4).
- **No logs are forwarded** to the telemetry backend (telemetry design, section 2), and nothing may
  carry a token, a URL or a header (OBSERVABILITY.md).

## Decisions

### 1. The candidates

| Candidate | Decision | Why |
|---|---|---|
| **Use of an invalid or revoked MCP token** | **Accept** as `mcp_token_rejected` | It is the credential the product hands to an outside agent (SECURITY.md), it is exactly the event D-049's security class exists for, and it is observed where it happens: the resource server refuses it. A client that is behaving normally presents tokens that verify or that have merely expired; a token that fails verification, belongs to another audience, or was revoked is not normal. Revoked and invalid are one value: until introspection exists the resource server may not be able to tell them apart, and the response to either is the same (look at the Supabase Auth record of the client authorization). **Reconsider the split** when the transport can distinguish them. |
| **Repeated failed authentication: machine credential** | **Accept** as `synthetic_credential_rejected` | The synthetic exchange is a public server route that takes a long-lived secret. Repeated refusals mean a guessing attempt, a leaked and rotated-out credential in use, or a runner with a stale credential. All three need a human, and the third also breaks the synthetic checks. It is observed in our own code. It cannot be marked `synthetic`: nothing has authenticated (`add-synthetic-user`). |
| **Repeated failed authentication: interactive email code** | **Not accepted in v1; decision requested** | There is no observation point (Context). Of the ways to create one, none is free: a browser report is spoofable and is not an allowed sole source for an alert, so it is rejected outright; a server-mediated verification route changes the sign-in flow of an offline-first PWA and needs its own spec and ADR; Supabase's own logs may or may not expose refused verifications, which is unverified. The proposal lays the three options out for Vladimir. Adding an enum value nothing can emit would make a closed domain lie, so none is added. |
| **Rejected cross-user access** | **Reject** | *There is nothing to observe.* (a) A write cannot express another user: it has no user parameter and derives the user from `auth.uid()` (I-1). (b) A read of another user's rows is not refused, it is filtered: forced row level security returns zero rows (I-3), indistinguishable from a normal empty read, so any count of it would be noise. (c) A direct table write is revoked (I-2) and would fail inside Postgres under the user's own token, in a process that emits no telemetry. (d) The product has one user. A second principal does not exist, and SECURITY.md already requires a new disclosure policy before one is onboarded. The control is the wrong-user suites (`wrong-user.provider.ts`, `authenticated-rpc.provider.ts`) that run in CI and fail the build; that is a build-time control, not an alert, and this change does not pretend otherwise. **Reconsider if** a second user is onboarded or an application server joins the data path. |

#### Rejected inside the accepted candidates

| Case | Decision | Why |
|---|---|---|
| Expired access token | Not recorded | Access tokens last 15 minutes (SECURITY.md). Expiry is the routine path of every refresh and a clock difference. Recording it would page on correct operation and teach the alert to be ignored. |
| No credential presented | Not recorded | An internet-facing endpoint is scanned. Counting requests with no token measures the internet, not misuse. |
| Valid token, missing scope; unknown tool | Not recorded | The credential is genuine and was granted by the user. A call beyond its scope is a client defect or a probe by an already-authorized client, and the refusal is already tested (`authorization.test.ts`, `tool-surface.test.ts`). It is not misuse of a credential. |
| Rate limited | Not recorded | The limiter is keyed by an authorized client. Hitting it is a runaway client, and it already answers with `retryAfter`. |
| A reason per rejection (`bad_signature`, `wrong_audience`, `too_long`, ...) | Rejected for v1 | It widens the closed domain by half a dozen values nothing in the alert would branch on. The response to the caller already carries the standard `invalid_token` error; the operator investigates in the Supabase Auth record. **Cost, stated plainly:** the page says *that* a credential was refused, not *why*, and no log carries the reason. Add a reason enum later if investigations show it is needed. |
| Client id, subject, email, address or user agent as an attribute | Rejected | Unbounded, and forbidden (R-018, OBSERVABILITY.md). |
| A `synthetic` label | Rejected | A refused credential has not authenticated, so the server cannot know. The label would always be `false` and would double the series for nothing. |

### 2. The closed telemetry value

One new event name and one new attribute:

| | Value |
|---|---|
| Event name | `security.event` |
| Attribute | `security.outcome` |
| Domain (closed enum) | `mcp_token_rejected`, `synthetic_credential_rejected` |

- `mcp_token_rejected`: an MCP invocation presented a credential that failed verification: not
  verifiable, not issued for this resource, a validity window that is malformed, longer than 15
  minutes or not yet started, or revoked where the transport can tell. Not an expired token.
- `synthetic_credential_rejected`: the synthetic exchange refused a presented credential: no stored
  digest matches, or the matching digest is past its end date.

The event is recorded once per refused request, after the refusal is decided. The outcome is the
only attribute.

**Section 2.1 classification** (to be added to the telemetry design by the guardrail PR):

| Allowlisted attribute | Role in OTLP | Why |
|---|---|---|
| `security.outcome` (2) | metric label | Enumerated |

| Event | Instrument | Labels | Ceiling of series |
|---|---|---|---|
| `security.event` | counter | `security.outcome` | 2 |

The mapping fixes the dimension: anything else a `security.event` carries is not a label. The
ceiling rises by 2 for each emitting service and by 4 across both, so the totals in section 2.1
(about 2,100 per service, 4,200 for both) are unchanged to the stated precision and the 5,000 test
ceiling holds. Counting the `integrity.check` event proposed by `add-possible-loss-signal`
(3 series) as well leaves the totals still unchanged to that precision.

**What the guardrail PR changes, mechanically** (`packages/observability`, its own PR, D-035):

1. `allowlist.ts`: add `'security.outcome'` to `ALLOWED_ATTRIBUTES`; add `'security.event'` to
   `EVENT_NAMES`; add `export const SECURITY_OUTCOMES = ['mcp_token_rejected',
   'synthetic_credential_rejected'] as const`; add `'security.outcome': oneOf(SECURITY_OUTCOMES)` to
   `DOMAINS`. `DOMAINS` is typed `Record<AllowedAttribute, Domain>`, so the compiler forces the
   entry.
2. The OTLP mapping: `security.event` is a counter whose only label is `security.outcome`.
3. Tests: `closed-domains.test.ts` accepts each value and rejects a third, a sentinel string, a
   number and a boolean; the cardinality test's classification table gains the row and passes; the
   wire canary emits `security.event` through its entry point with a sentinel token, client id and
   email beside it and the sentinel appears nowhere.
4. Docs in the same guardrail PR: the allowlist and value-domain tables in `OBSERVABILITY.md`, the
   event and row in section 2.1 of the telemetry design, and the allowlist sentence in the
   `telemetry-privacy` spec.

Both emitters use the existing `service.name` values (`workout-mcp`, `workout-web`). No new service
name is needed.

### 3. Where it is recorded

- **MCP.** In `apps/mcp`, where an invocation is refused. `authorizeInvocation` returns the typed
  failure; a pure mapping from failure to outcome (or to "not recorded") is unit-testable today:
  `invalid_validity_window`, `lifetime_too_long`, `token_not_yet_valid` and `audience_mismatch`
  record `mcp_token_rejected`; `token_expired`, `missing_scope` and `unknown_tool` record nothing.
  Failures found by the transport before `authorizeInvocation` (signature, issuer, revocation) record
  `mcp_token_rejected` too. The transport is an external gate (G-1 to G-4); until it exists the
  mapping is tested and nothing is emitted.
- **Synthetic exchange.** In the route that `add-synthetic-user` defines, at its refusal branch. It
  stays in the same change as that implementation, which depends on this one being approved.
- The emitter calls `Telemetry.record` only. It never calls an OpenTelemetry SDK, and it sits behind
  the same start-up canary gate as every other emitter.

**Telemetry never decides.** The call is made after the decision, is not awaited by the response,
and a thrown error in it is swallowed. A refusal stays a refusal when telemetry is off, failing or
slow. This is the reverse of the canary rule on purpose: the canary fails closed on *exporting*,
and the authorizer must never fail open because of *telemetry*.

### 4. Alert and drill (separate issues, blocked on T3)

| Alert | Condition | Routes |
|---|---|---|
| Credential rejected | any increase of `security.event` (any outcome) in 15 minutes | A + B |

- **First occurrence pages.** The product has one user and one authorized agent; a refused
  credential is rare. The threshold is a starting point and is set in the drill, not here.
- **No data is the healthy state.** A counter that has never been incremented has no series. This
  rule must treat NoData as OK, the opposite of the synthetic-silent rule. A dead exporter is
  covered by that rule and by the synthetic check, not by this one. The drill is what proves the
  emitter is wired end to end.
- **Routing, template and payload** are the existing ones: labels derive from the allowlist, so the
  payload carries the outcome and nothing else.
- The "Auth failure" rule (5xx `auth.event`) is unchanged. Whether synthetic 5xx counts toward it is
  T3's decision, recorded in `add-synthetic-user`.

Drill, against a **non-production** stack and project, after T3: (1) present a malformed bearer
value and one with the wrong audience to the preview MCP and confirm two `mcp_token_rejected` and an
alert on both Telegram and the signed Hermes webhook; (2) present a wrong credential to the preview
synthetic exchange and confirm `synthetic_credential_rejected` and the alert; (3) present an
expired token and a token without the scope and confirm **no** event and no alert; (4) with telemetry
configured to fail, present a bad token and confirm the request is still refused. Record date,
evidence and who signed it off, someone other than the runner (the Platform & Reliability role may
not sign off its own drill).

## Coverage: what this does and does not close

Covers: use of a refused MCP credential and a refused synthetic credential, with a notification on
both paths once built and drilled.

Does **not** cover:

- **Interactive sign-in failures.** Open until Vladimir picks A, B or C (proposal). The authentication
  class of D-049 stays partial for that path.
- **A stolen but valid token.** A token that verifies is accepted and produces no signal. Containment
  is the 15-minute lifetime, revocation within 5 minutes and per-invocation re-authorization
  (SECURITY.md), not detection.
- **Cross-user access.** Rejected above; build-time tests only.
- **Why a credential was refused**, and **which client** presented it. Deliberately not recorded.
- **Latency below the evaluation window**, and anything that happens while telemetry is off.
- **Other security conditions**: a leaked secret, a compromised service-role key, a malicious
  dependency. Those have their own controls (secret scanning, supply-chain gates) and no signal here.

The proposal asks Vladimir whether this satisfies D-049 for the security class. If it does not, the
only alternative in the telemetry design is a narrowing of D-049 and OBSERVABILITY.md, which is a
product-intent change an agent cannot make (D-7b).

## Alternatives rejected

- **One value `credential_rejected` for both sources.** `service.name` would separate them in
  practice, but the label set would then depend on a resource attribute mapping that is not
  verified. Two values cost nothing and keep the dashboard honest.
- **Extend `auth.event` with the new outcome.** `auth.event` has a declared meaning and a
  `response.class` label; overloading it makes the Auth failure rule match unrelated events and
  mixes server faults with credential refusals.
- **Report sign-in failures from the browser.** Spoofable, unauthenticated, and browser
  instrumentation is unstable (OBSERVABILITY.md). A caller who can raise or silence a page does not
  have an alert.
- **Count empty reads or RLS denials as cross-user access.** See candidate 4.
- **A per-client or per-subject counter.** Unbounded cardinality and an identifier in telemetry.
- **Forward Vercel or Supabase request logs for investigation.** They hold resolved URLs and
  identifiers; the telemetry design excludes them (section 2).

## Risks

- **A scanner with junk bearer values pages the user.** The first weeks may need a threshold above
  one. That is tuned in the alert, not in the signal, and is the reason the threshold is not fixed
  here.
- **A page without a reason.** Accepted cost, above. Investigation depends on the Supabase Auth
  record, which this change neither reads nor retains.
- **The MCP transport does not exist.** The MCP half is a tested mapping until G-1 to G-4 are met and
  the transport is built. Nothing is emitted before then.
- **Unverified boundary.** Nothing here ran. No token was rejected, no event exported, no alert
  routed, and the Supabase hooks page was read, not exercised.
