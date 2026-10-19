## Purpose

Defines the one machine principal that the synthetic checks sign in as, how it proves who it is,
how the server knows its traffic is synthetic, and why it can never appear in the real user's
views or in what the external agent reads.

## ADDED Requirements

### Requirement: One synthetic user per environment, marked by a claim only the server can set
Each environment (development, preview, production) SHALL have at most one synthetic user, in that
environment's own Supabase project. The synthetic user SHALL carry `app_metadata.synthetic = true`
in Supabase Auth. Its email address MUST be one that cannot receive mail, so the public email-code
sign-in cannot produce a session for it. No user-facing call, including one made by the synthetic
user itself, MUST be able to set or clear `app_metadata`.

#### Scenario: A signed-in user tries to mark themselves synthetic
- **WHEN** a signed-in real user updates their own profile with `synthetic: true` in user data
- **THEN** their access token still carries no `app_metadata.synthetic` claim
- **AND** requests made with it are not synthetic

#### Scenario: Two environments never share a synthetic user
- **WHEN** the preview and production configurations are inspected
- **THEN** each names a synthetic user id from its own Supabase project, and the two ids differ

#### Scenario: No password is introduced
- **WHEN** the authentication configuration is inspected after this change
- **THEN** no password credential is stored or accepted for the synthetic user or any other user

### Requirement: The only machine sign-in is a server-side credential exchange
The system SHALL provide one server route that exchanges the synthetic credential for an access
token of the synthetic user. The credential SHALL be a random secret of at least 256 bits with a
fixed, recognizable prefix so secret scanning can find it. The route MUST accept the credential only
in the `Authorization: Bearer` header, MUST accept no user identifier from the request in any form,
and MUST return an access token whose subject is the configured synthetic user id. The response
MUST NOT contain a refresh token, and the access token MUST NOT live longer than one hour.

#### Scenario: A valid credential
- **WHEN** a runner posts an empty body with a valid credential
- **THEN** the response is 200 with an access token and its expiry
- **AND** the token's subject equals the configured synthetic user id
- **AND** the token carries `app_metadata.synthetic = true`
- **AND** the token expires no more than one hour after it was issued
- **AND** the response contains no refresh token

#### Scenario: The credential is wrong, missing or malformed
- **WHEN** the request has no credential, a credential with a wrong prefix, a wrong value, a wrong
  scheme, or the credential in a query string instead of the header
- **THEN** the response is 401 with the same body in every case
- **AND** no call is made to Supabase Auth and no token is minted

#### Scenario: The request names a user
- **WHEN** a request with a valid credential carries a user id, email, or `sub` in the body, query
  string or a header
- **THEN** the response is 400 and no token is minted

#### Scenario: The real user's id is never reachable
- **WHEN** the project holds the real user and the synthetic user
- **AND** the exchange is called with every input the route accepts, valid and invalid
- **THEN** no returned token has the real user's id as its subject

#### Scenario: Only the synthetic user can be minted
- **WHEN** the configured synthetic user id points at a user whose `app_metadata.synthetic` is not
  true, for example the real user's id by mistake
- **THEN** the response is 503 and no token is minted

#### Scenario: Not configured
- **WHEN** no synthetic user id or no valid credential digest is configured
- **THEN** the route responds 404 with the same body as an unknown route, whatever the request
  carries

#### Scenario: A guess does not lock out the runner
- **WHEN** a thousand requests with wrong credentials are followed by one with the valid credential
- **THEN** the valid request succeeds

#### Scenario: Supabase Auth is unreachable
- **WHEN** a valid credential is presented and Supabase Auth cannot be reached or refuses to issue
- **THEN** the response is 503 with a `Retry-After` header and nothing partial is returned

#### Scenario: Other methods
- **WHEN** the route receives a GET
- **THEN** the response is 405

### Requirement: The credential is stored as digests, expires and rotates
The server SHALL hold only SHA-256 digests of the credential, never the credential. It SHALL accept
at most two digests at once. Each digest SHALL declare a start and an end instant, and the end MUST
NOT be more than 90 days after the start. A digest outside its window MUST NOT verify. A
configuration that breaks these rules MUST disable the route as if it were not configured, and MUST
NOT fall back to a weaker rule.

#### Scenario: Rotation with an overlap
- **WHEN** the configuration holds the old and the new digest, both inside their windows
- **THEN** the old credential and the new credential both exchange successfully
- **AND** after the old digest is removed, the old credential gets 401 and the new one succeeds

#### Scenario: A digest past its end
- **WHEN** the current time is after a digest's end instant
- **THEN** a credential that matches that digest gets 401

#### Scenario: A digest not yet started
- **WHEN** the current time is before a digest's start instant
- **THEN** a credential that matches that digest gets 401

#### Scenario: A window longer than 90 days
- **WHEN** the configuration holds a digest whose end is more than 90 days after its start
- **THEN** the route behaves as not configured, for every credential

#### Scenario: Three digests
- **WHEN** the configuration holds three digests
- **THEN** the route behaves as not configured, for every credential

#### Scenario: The credential is never recorded
- **WHEN** the exchange is called with a sentinel credential, once successfully and once not
- **THEN** the sentinel and the issued access token appear in no log line, no telemetry event, no
  error body, and no response header

### Requirement: Whether a request is synthetic is decided by the server from the verified identity
The system SHALL decide `synthetic` once per request, at the point where the request is
authenticated, and SHALL be true only when the verified access token carries
`app_metadata.synthetic = true`. Every telemetry event the request produces, including its error
responses, SHALL carry that value. A header, query string, body field, cookie, or `user_metadata`
value MUST NOT influence it. A request with no valid token SHALL be recorded as `synthetic=false`.

#### Scenario: A synthetic request
- **WHEN** a request carries a valid access token issued by the exchange
- **THEN** every event it produces carries `synthetic: true`, including a 4xx or 5xx response

#### Scenario: A real request claims to be synthetic
- **WHEN** the real user's request carries a header, query value or body field saying it is
  synthetic
- **THEN** every event it produces carries `synthetic: false`

#### Scenario: A synthetic request claims to be real
- **WHEN** a request with the synthetic token carries a header saying `synthetic: false`
- **THEN** every event it produces still carries `synthetic: true`

#### Scenario: A forged claim
- **WHEN** a request carries a token with `app_metadata.synthetic = true` that is unsigned, signed
  with another key, or expired
- **THEN** the request is unauthenticated and its events carry `synthetic: false`

#### Scenario: Metadata the user controls
- **WHEN** a real user's token carries `user_metadata.synthetic = true` and no `app_metadata` claim
- **THEN** their events carry `synthetic: false`

#### Scenario: Real traffic is never marked
- **WHEN** a hundred requests are made by the real user, signed in and not
- **THEN** none of their events carries `synthetic: true`

#### Scenario: A successful exchange is itself synthetic
- **WHEN** the exchange succeeds
- **THEN** its single `auth.event` carries `synthetic: true` and a `response.class` of `2xx`

#### Scenario: A failed exchange is not synthetic
- **WHEN** the exchange rejects a credential
- **THEN** its `auth.event` carries `synthetic: false`, because nothing has authenticated

#### Scenario: A client cannot send the flag
- **WHEN** a mutation or request body carries a `synthetic` field
- **THEN** it is refused by the closed schema and never read as the flag

### Requirement: The synthetic user is invisible to the real user and to the agent
The synthetic user's rows SHALL be readable only by the synthetic user. No view, history, summary,
export, proposal list, search, or MCP resource served to the real user, or to a client authorized
by the real user, MUST contain a synthetic row. The synthetic user MUST NOT be able to read or
change any row of the real user. This SHALL hold through row-level security and the existing
boundary functions (ADR-0012 I-1, I-3), and SHALL NOT depend on a flag on workout rows or a filter
added to individual queries.

#### Scenario: The real user after a synthetic run
- **WHEN** the synthetic user has recorded sessions, sets and a proposal
- **THEN** the real user's reads of plans, sessions, sets, proposals and exports return none of them

#### Scenario: The agent after a synthetic run
- **WHEN** the external agent reads through a client authorization of the real user after a
  synthetic run
- **THEN** no resource it receives contains a synthetic row, so no proposal it creates can be based
  on one

#### Scenario: The synthetic user reads the real user's rows
- **WHEN** the synthetic user selects from, or calls a boundary function against, any protected
  relation holding the real user's rows
- **THEN** the read returns nothing and the write is refused

#### Scenario: The wrong-user suites include the synthetic user
- **WHEN** the deny-by-default suite runs for every protected relation and every operation
- **THEN** it includes the pair real user and synthetic user, in both directions, and fails if a
  relation or operation has no case for it

#### Scenario: A new cross-user aggregate
- **WHEN** a query or export is added that reads rows of more than one user
- **THEN** it is not accepted unless it excludes the synthetic user, and a test proves it

### Requirement: The MCP smoke call uses ordinary MCP authorization
The synthetic user's MCP call SHALL use an MCP access token issued to the synthetic user under the
rules in SECURITY.md: bound to the MCP resource's audience, expiring within 15 minutes, carrying
scopes enforced separately on every invocation. The system MUST NOT add an MCP credential, scope or
code path that exists only for synthetic checks, and MUST NOT accept the exchange's web access
token as an MCP token. This requirement takes effect when the MCP authorization server and
resource server exist (G-1, G-3, G-4); until then the MCP smoke journey is not covered.

#### Scenario: The synthetic user's MCP read
- **WHEN** the MCP smoke call reads with a valid token of the synthetic user
- **THEN** it returns the synthetic user's data only, and its events carry `synthetic: true`

#### Scenario: The web token as an MCP token
- **WHEN** the access token returned by the exchange is presented to the MCP server
- **THEN** it is rejected for audience

#### Scenario: A synthetic token with the wrong scope or audience
- **WHEN** a synthetic MCP token lacks the scope for the tool, or names another audience
- **THEN** the invocation is rejected exactly as it would be for the real user's token

### Requirement: The exchange is the only deployed use of the service-role key, and it cannot leave the browser
The service-role key SHALL be read only by the adapter function that issues the synthetic session.
That function MUST take no user identifier from its caller, MUST look up the configured synthetic
user and check its `app_metadata.synthetic` claim before issuing, and MUST fail closed on any
mismatch. The key MUST NOT appear in a browser bundle, a service-worker cache, a log, or a trace.

#### Scenario: The bundle is scanned
- **WHEN** the built client bundle is scanned for the service-role key after this change
- **THEN** it is absent

#### Scenario: The adapter is called with a user id
- **WHEN** a type test passes a user id, email or subject to the issuing function
- **THEN** the test fails to compile, because the function's signature has no such parameter

#### Scenario: A browser configuration with the key
- **WHEN** a browser configuration is constructed from input carrying the service-role key
- **THEN** the construction fails rather than ignoring the key
