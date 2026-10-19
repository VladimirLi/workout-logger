## Why

D-049 requires an immediate notification for security and authentication failures. The telemetry
design (`docs/design/telemetry-and-synthetic-checks.md`, section 6) found that the only
authentication signal is `auth.event` with `response.class=5xx`, a server-side failure of sign-in,
and that the security class has no signal at all. Failed or abusive attempts and token misuse
cannot be seen, and G-5 cannot close while that is true (D-7b, approved 2026-10-01). The design
left the signals to an OpenSpec change (T12) because they touch authorization and add a new closed
telemetry value.

This is task T12, spec half. Implementation, the allowlist guardrail PR, the alert rule and the
drill are separate issues created after approval.

Serves: D-049 (security, authentication), R-018 (metadata-only telemetry), D-019 and D-020 and
R-020 (MCP authorization), D-024 and R-012 (passwordless web authentication), ADR-0012 (the
database is the only trusted writer), D-035, D-050, VLA-714, VLA-256, G-5.

## What Changes

- **One event, one closed outcome.** A new event `security.event` with one new attribute
  `security.outcome`, whose domain is exactly `mcp_token_rejected` and
  `synthetic_credential_rejected`. It is a counter with that one label. Nothing else is attached:
  no client id, subject, email, address, token, reason or header.
- **Two candidates accepted, both server-side.**

  | Candidate | Decision |
  |---|---|
  | Use of an invalid or revoked MCP token | **Accepted** as `mcp_token_rejected` |
  | Repeated failed authentication, machine credential (the synthetic-user exchange, `add-synthetic-user`) | **Accepted** as `synthetic_credential_rejected` |
  | Repeated failed authentication, interactive email-code sign-in | **Not accepted in v1.** No server-side observation point exists. **Decision requested** (below) |
  | Rejected cross-user access | **Rejected.** There is no rejection to observe in this architecture |

  The reasons, and what was rejected inside each row (expired token, missing scope, rate limit, a
  per-reason outcome), are in `design.md`.
- **The signal observes; it never decides.** Who is authorized is unchanged. A refusal is the same
  refusal, and a telemetry failure never turns a refusal into an acceptance.
- **Alert, initial thresholds and drill** are specified in `design.md` and built later (T3). The
  initial rule pages on the first rejected credential; the threshold is tuned in the drill.

## Decision requested from Vladimir

1. **Does this set satisfy D-049 for the security class?** It covers misuse of the two server-held
   credentials. It does not cover the interactive sign-in (item 2), cross-user access (rejected, no
   event exists) or anything outside credentials.
2. **Interactive email-code sign-in.** The browser calls Supabase Auth directly. Our code never sees
   a refused code, Supabase documents no auth hook for a refused one-time-code verification (read
   from the public hooks page on 2026-10-19), and a browser report is spoofable and may not be the
   sole source of an alert (OBSERVABILITY.md). Three ways forward, none chosen here:

   | Option | Cost | Note |
   |---|---|---|
   | A. Server-mediated verification route | Changes the sign-in flow and its session handling for an offline-first PWA; a new route template; its own spec and ADR | Gives an exact signal. Not recommended without a separate decision |
   | B. Read Supabase's own auth logs from a scheduled runner | Needs a read credential (G-9); whether the logs expose refused verifications and how long they are kept is **unverified** | Recommended to *verify first*, read-only, after this spec is approved |
   | C. Narrow D-049 for interactive sign-in to "outage" (the existing 5xx `auth.event`) plus Supabase's own rate limits | A product-intent change to D-049 and OBSERVABILITY.md; only Vladimir can approve it | The honest fallback if B is not available |

   Until this is decided the authentication class stays **partial** for the interactive path and
   G-5 stays open on it. This change does not narrow D-049.

## Capabilities

### New Capabilities
- `security-signals`: the `security.event` event and `security.outcome` attribute, when each outcome
  is and is not recorded, what the event never carries, and the alert that consumes it.

### Modified Capabilities
- `telemetry-privacy`: its allowlist sentence and value-domain list gain `security.outcome`, and
  its closed event names gain `security.event`. Applied by the guardrail PR, not by this change.
  The `establish-project-foundation` change that introduces the capability is not archived, so
  this is stated here rather than as a delta on a published spec.

## Impact

**Affected packages (later, not by this change):** `packages/observability` (allowlist, mapping,
tests; guardrail PR), `apps/mcp` (record on rejection), `apps/web` (record on a rejected
synthetic exchange, after `add-synthetic-user` is implemented). `packages/domain`,
`packages/application`, `packages/contracts` and the database are untouched. Dependency
direction holds: `apps -> adapters -> application -> domain`, with `contracts` alongside, and only
`packages/observability` calls an OpenTelemetry SDK.

**Not touched here:** this change edits only `openspec/changes/add-security-signals/`. It creates
no account, credential, token, secret or cloud resource and edits no guardrail file.

**Guardrails.** The implementation needs an allowlist change (`packages/observability`,
`OBSERVABILITY.md`), which is a guardrail PR of its own and never ships with product code (D-035).

**Owner gate.** This touches authorization and alters what the product records about
credentials, so the spec needs Vladimir's explicit approval on the PR after independent review
(AGENTS.md). Nothing in the implementation list starts before that.

**Does not close G-5.** G-5 stays open until the whole breakdown ships, including T11 and the
interactive-sign-in decision above. Nothing here was run: no alert fired, no token was rejected,
no export happened. Everything is specified, not built.
