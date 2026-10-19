## Why

Production verification (D-045, D-046) and the 15-minute synthetic journeys need a machine that
can sign in and use the product. Sign-in is an emailed one-time code or a passkey, and a machine
can answer neither. OBSERVABILITY.md already requires the checks to run as an isolated synthetic
account, excluded from normal views and from agent recommendations, with `synthetic=true` on its
telemetry. Nothing says how that account authenticates, what keeps it out of the real user's
views, or who decides `synthetic=true`.

The telemetry design (`docs/design/telemetry-and-synthetic-checks.md`, section 5) left the
mechanism open because it touches authorization, and Vladimir approved writing this change as
decision D-4 (VLA-256). This is task T5, spec half; the implementation is a separate issue created
after approval.

Serves: D-045, D-046 (production verification), D-043 (rollback on failed verification), D-049
(critical-journey failure), R-018 (metadata-only telemetry), D-024 and R-012 (passwordless web
authentication), R-013 (database authorization), ADR-0001, ADR-0005, ADR-0012, VLA-712, G-5.

## What Changes

- One synthetic user per environment, marked by `app_metadata.synthetic = true` in Supabase Auth,
  a claim that no user-facing API can set. It has an address that cannot receive mail, so the
  public email-code path cannot sign in as it.
- A server-side credential exchange: a runner presents a long-lived random credential and receives
  a short-lived access token for the synthetic user, and for no other user. No refresh token is
  issued. The server stores only digests of the credential, accepts at most two at once, and
  refuses a digest that is past its declared end date, so the credential rotates on a schedule.
- `synthetic=true` is computed once per request, on the server, from the verified access token's
  `app_metadata.synthetic` claim. No header, query, body, cookie or `user_metadata` value can set
  it.
- Exclusion from views and recommendations comes from the existing isolation (ADR-0012 I-1, I-3)
  and is proved by running the wrong-user suites with the synthetic user as the other identity.
  No new column, view filter or flag on workout rows is added.
- The synthetic user's MCP smoke call goes through the ordinary MCP authorization. No MCP bypass
  is created.

## Capabilities

### New Capabilities
- `synthetic-user`: the synthetic principal, its credential exchange, the server-side
  `synthetic` flag, and its isolation from the real user.

### Modified Capabilities
- _(none)_ The `identity` and `telemetry-privacy` capabilities are introduced by changes that are
  not archived, so this change adds a capability and does not modify a published spec. It relies on
  them and does not weaken them: no password is stored or accepted (`identity`), and the
  `synthetic` attribute stays a boolean on the existing allowlist (`telemetry-privacy`).

## Impact

**Affected when implemented:** `packages/application` (a use case and a port that issues a session
for the synthetic user), `packages/adapters-supabase` (the adapter, and the synthetic identity in
the wrong-user suites), `packages/contracts` (the closed exchange request and response),
`apps/web` (one server route and the per-request flag), `apps/mcp` (the same flag derivation).
Dependency direction holds: apps -> adapters -> application -> domain, with contracts alongside.

**Not touched here:** this change edits only `openspec/changes/add-synthetic-user/`. It creates no
user, credential, digest, secret or cloud resource, and edits no guardrail file.

**Guardrails.** No allowlist change is needed. The exchange records `auth.event` with
`response.class` and `synthetic` only, and no new route template, operation or event name. If
implementation finds it needs one, that is a separate guardrail PR in `packages/observability`
(D-035).

**Cost of the chosen design.** The exchange is the first use of the Supabase service-role key in a
deployed server route. It is confined to one adapter function that cannot take a user id from the
request (design, "Service-role exposure").

**Owner gate.** This alters user-visible behavior and touches authorization, so the spec needs
Vladimir's approval on the PR after independent review (AGENTS.md). Provisioning the user and
issuing the first credential are human-authorized gates (G-2, G-5, G-9) and are not requested by
this change.

**Does not close G-5.** G-5 stays open until the whole breakdown ships, including T11 and T12.
Failed exchange attempts are not a defined security signal here; T12 decides that.
