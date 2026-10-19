## Context

The synthetic checks run in production against a dedicated account (OBSERVABILITY.md, D-045,
D-046). Sign-in is an emailed code or a passkey, so a machine has no way in. The telemetry design
requires a credential that works only for the synthetic user id, is checked server-side, and
rotates, and it leaves the mechanism to this change because it touches authorization.

Constraints that shaped the choice:

- Authority stays in the database (ADR-0012). The synthetic user must act through the same
  `auth.uid()`, row-level security and boundary functions as the real user, so no second
  authorization path is created.
- The product stores no password (identity capability, D-024).
- Two runners use the credential: a Grafana k6 check every 15 minutes (stateless between runs) and
  a GitHub Actions `verify-deployment` on each deploy. Both may run at once.
- No account, spend or secret may be requested by this change. The mechanism must be buildable and
  testable against the Free development project (G-2, ADR-0011).

## Decisions

### 1. A credential exchange route, not a sign-in flow

The runner posts a long-lived random credential and gets a short-lived access token for the
synthetic user. Everything after that is the ordinary product API with an ordinary user token, so
every existing rule (RLS, boundary functions, the wrong-user suites) applies unchanged.

The credential is `wls_` plus 32 random bytes in base64url. The prefix lets secret scanning
recognize it. The server holds SHA-256 digests only. A fast hash is correct here: the secret has
256 bits of entropy, so a slow password hash buys nothing. Comparison is on the digest, in constant
time.

Issuing the session uses the Supabase Auth admin API: look up the configured user, check its
`app_metadata.synthetic`, generate a sign-in link for it without sending mail, and verify the
hashed token it returns. The refresh token that comes back is dropped. The implementer confirms the
exact calls against the development project; this change did not run them.

### 2. `synthetic` comes from `app_metadata` in the verified token

Supabase puts `app_metadata` in the access token. Only the service role can write it, and a user
can write only `user_metadata`. So the claim is a fact about the identity that the user cannot
edit, and it is read from a token whose signature the server has already verified. The flag is
computed once where the request is authenticated and passed to telemetry as part of the request
context, so no route has to remember to set it.

Failure direction: anything that cannot be read as a verified `app_metadata.synthetic = true` is
`false`. A broken check therefore counts synthetic traffic as real, which can only make an SLO
look worse, never hide a real failure.

### 3. Exclusion is isolation, not a filter

The real user's views and the agent's reads cannot contain the synthetic user's rows because those
rows belong to another `auth.uid()` (ADR-0012 I-1, I-3). The change adds no column and no
per-query filter, because a filter has to be remembered in every future query and isolation does
not. The proof is the existing wrong-user suites, run with the synthetic user as the second
identity in both directions, which the identity capability already requires to cover every
relation and operation.

The one place isolation does not help is a future cross-user aggregate. There is none today (single
user). The spec makes it a rule that any such query excludes the synthetic user and has a test.

### 4. Rotation by expiry

The server configuration is a list of at most two entries: digest, start, end, with the end at most
90 days after the start. An expired or not-yet-started entry does not verify. This turns "rotates"
into something that is enforced and testable, not a calendar reminder. The cost is intended: a
forgotten rotation makes the synthetic check fail and page, so rotation is a drilled routine.

Rotation order, which works while the checks keep running: add the new digest and deploy; update
the runners' secret; remove the old digest and deploy. The deploy-time check in step three
authenticates with the new credential.

Revocation takes effect at the next deployment or by removing the configuration. That is slower
than the five-minute propagation SECURITY.md sets for MCP refresh credentials, and acceptable here
because a leaked synthetic credential can reach synthetic data only (decision 3).

### 5. No lockout

Rate-limiting by failed attempts would let an anonymous caller lock the runner out, which silences
or falsely pages the very check the credential exists for. With 256 bits, guessing is not a
realistic attack. The route does constant-time digest comparison and does no work against Supabase
until the credential has verified.

### 6. Service-role exposure

The exchange is the first deployed use of the Supabase service-role key. It is the cost of this
design, and the mitigation is to make the capability narrow rather than the key absent:

- one adapter function holds it, in `packages/adapters-supabase`, behind a port declared in
  `packages/application`;
- the function takes no user id from its caller, reads the configured id, and refuses unless that
  user carries `app_metadata.synthetic = true`, so pointing the configuration at the real user
  fails closed;
- the existing bundle scan and browser-configuration refusal still apply.

If Vladimir does not accept the key in the web runtime, the fallback is the same exchange as a
Supabase Edge Function, where the platform injects the key and the web app never sees it. It adds a
second runtime and deployment target, so it is not the default.

### 7. Telemetry from the exchange adds nothing to the allowlist

The exchange records one `auth.event` with `response.class` and `synthetic`. It needs no new route
template, operation or event name, so there is no guardrail PR in `packages/observability`. This
also means failed exchanges are visible only as 4xx `auth.event`s. Whether repeated failed
attempts are a security event is the T12 decision (design section 6.1); this change reserves
nothing for it.

One consequence for T3: a 5xx on the exchange after the credential verified is `synthetic: true`,
and one before it is `synthetic: false`. The "Auth failure" alert rule must state whether synthetic
auth events count. That is the alert-as-code task's decision, noted here so it is not missed.

## Rejected alternatives

| Alternative | Why not |
|---|---|
| A password for the synthetic user | The product stores no password and the identity capability requires that to be inspectable. Enabling the password provider would apply to the whole project, not one user |
| A mailbox the runner reads for the email code | Needs a mailbox account, adds mail delivery to every check so a mail outage reads as an app outage, and sends about 2,880 mails a month |
| A fixed test one-time code | Supabase offers it for phone numbers only, which would need an SMS provider |
| The runner holds a Supabase refresh token | It rotates on use and the k6 check keeps no state between runs. Two runners, or one retry, would trip reuse detection and kill the session |
| The app signs its own JWT for the synthetic user | Needs the signing key in the runtime, which is a larger capability than the service-role call restricted to one user, and adds a second token issuer to the database's trust |
| A `synthetic` column on workout rows with query filters | Every future query must remember it. Isolation by `auth.uid()` already excludes the rows with nothing to remember |
| Lockout after failed attempts | An anonymous caller could silence the synthetic check (decision 5) |
| Reading `synthetic` from a header the runner sends | Anyone could send it, and real traffic could move the SLO numerator, which is what the design set out to prevent |
| A synthetic-only MCP credential | A second authorization path nobody exercises except the check. The MCP leg uses ordinary MCP tokens |

## Risks and what was not verified

- Nothing here was run. The Supabase admin calls, the claim being present in the access token, and
  `app_metadata` being unwritable by a user are stated from Supabase's documented behavior and must
  be proved by the tests in the tasks against the development project before anything relies on
  them.
- Supabase Auth rate-limits token verification per IP. Server-side calls from shared platform
  addresses might hit it. The tasks include measuring it on the development project.
- Access-token lifetime is a project-wide setting, so the exchange cannot shorten it for one user.
  The spec caps it at one hour and the test reads it from the token. If the project setting is
  longer, the implementation is refused until it is lowered.
- Data growth: a journey that records a session every 15 minutes adds about 2,900 small sessions a
  month, and completed facts are immutable, so the product cannot delete them. This is arithmetic,
  not a measurement. T6 owns the journey and must measure the size and state a reset or retention
  rule before production, which would be its own spec if it needs a privileged purge.
- Steps of the journey that run before authentication (for example a bare health check) are not
  synthetic by this definition. T6 and T7 present the token on every step, including the health
  step, so the traffic is marked.
- The MCP leg is specified but cannot be built or tested until the MCP authorization and resource
  servers exist (G-1, G-3, G-4).
- G-5 stays open. This change supplies none of T11 or T12, and the D-049 security and data-loss
  classes still have no signal.

## Provisioning, which this change does not do

The synthetic user, its digest configuration and the first credential are created by a human-
authorized step per environment, using the service-role key held by Vladimir (G-2, G-9). The
implementation half adds a runbook for it, with examples only and no real value.
