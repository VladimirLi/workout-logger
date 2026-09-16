## ADDED Requirements

### Requirement: The MCP server serves as an OAuth protected resource
The remote MCP server SHALL serve over HTTPS as an OAuth-protected resource, publishing
protected-resource metadata and supporting authorization-server discovery. It MUST validate
audience, match redirects exactly, use PKCE where applicable, and MUST NOT pass tokens
through to another service.

#### Scenario: Protected-resource metadata is published
- **WHEN** a client requests the protected-resource metadata endpoint
- **THEN** it receives metadata naming the resource identifier and its authorization server

#### Scenario: An unauthenticated request
- **WHEN** a tool is invoked with no credential
- **THEN** the request is refused and the response indicates how to authorize

#### Scenario: A token for another resource
- **WHEN** a tool is invoked with a token whose audience is a different resource
- **THEN** the request is refused

#### Scenario: A redirect that is not an exact match
- **WHEN** an authorization request presents a redirect URI that is not registered exactly
- **THEN** the authorization is refused

#### Scenario: Plain HTTP is refused
- **WHEN** a request reaches the MCP endpoint over plain HTTP
- **THEN** it is refused

### Requirement: MCP credentials are separate from browser identity
The MCP credential SHALL be distinct from the browser session credential. Revoking one MUST
NOT require revoking the other.

#### Scenario: Revoking the agent authorization
- **WHEN** the user revokes the agent's client authorization
- **THEN** the agent can no longer read or propose, and the user's browser session is
  unaffected

#### Scenario: Signing out of the browser
- **WHEN** the user signs out of the PWA
- **THEN** the agent's authorization remains valid

### Requirement: Token lifetime, rotation, and revocation propagation
Access tokens SHALL expire within 15 minutes. Refresh credentials MUST be rotated, stored
encrypted in a managed secret store, and revocable with propagation within five minutes.
Tokens MUST NOT appear in URLs, logs, repository files, browser storage, or process arguments.

#### Scenario: An access token past 15 minutes
- **WHEN** a tool is invoked with an access token older than 15 minutes
- **THEN** the invocation is refused as expired

#### Scenario: Refresh rotation
- **WHEN** a refresh credential is exchanged
- **THEN** the previous refresh credential is invalidated

#### Scenario: Revocation propagates
- **WHEN** a client authorization is revoked
- **THEN** within five minutes no token issued under it is accepted

#### Scenario: Tokens are absent from logs
- **WHEN** logs and traces from an authorized invocation are inspected
- **THEN** no token value appears

### Requirement: Read tools return authoritative state
The MCP server SHALL expose read access to product capabilities, the active-plan revision,
scheduled sessions, completed-session summaries, exercise definitions, and proposal status.

#### Scenario: Reading the active plan revision
- **WHEN** an authorized agent reads the active-plan revision
- **THEN** it receives the current authoritative revision

#### Scenario: Reading completed-session summaries
- **WHEN** an authorized agent reads completed-session summaries
- **THEN** it receives typed measurements with their units and profiles

#### Scenario: Reading proposal status
- **WHEN** an authorized agent reads the status of a proposal it created
- **THEN** it receives the current status, including a stale status if the base revision moved

### Requirement: Result size caps, pagination, and rate limiting
Read tools SHALL cap result size, paginate history, and rate-limit invocations.

#### Scenario: Requesting more than the maximum page size
- **WHEN** an agent requests a page larger than the maximum
- **THEN** the request is refused rather than silently truncated

#### Scenario: Paging through history
- **WHEN** an agent reads history beyond one page
- **THEN** it receives a cursor to continue from

#### Scenario: Exceeding the rate limit
- **WHEN** an agent exceeds the invocation rate limit
- **THEN** it receives a retryable refusal indicating when to retry

### Requirement: Proposal tools create proposals over the wire
The MCP server SHALL expose proposal tools for plan replacement, scheduled-session change,
exercise-prescription change, and completed-session correction. Each invocation MUST create a
proposal record and MUST NOT alter authoritative data.

#### Scenario: Creating a plan-replacement proposal
- **WHEN** an authorized agent invokes the plan-replacement proposal tool with a base revision
  and a rationale
- **THEN** a pending proposal is recorded and the active plan is unchanged

#### Scenario: Creating a proposal without a rationale
- **WHEN** an agent invokes a proposal tool with no rationale
- **THEN** the invocation is refused

#### Scenario: Creating a proposal against an already-stale revision
- **WHEN** an agent invokes a proposal tool naming a base revision that is not current
- **THEN** the invocation is refused as stale, so the agent regenerates before the user is
  asked to review it

### Requirement: The user reviews proposals in the PWA
The PWA SHALL present each pending proposal with its base revision, structured diff,
rationale, and creation time, and MUST let the user accept or reject it.

#### Scenario: Reviewing a pending proposal
- **WHEN** the user opens a pending proposal
- **THEN** the base revision, the diff, the rationale, and the creation time are shown

#### Scenario: Accepting a still-current proposal
- **WHEN** the user accepts a proposal whose base revision is still current
- **THEN** the change is applied and the plan revision advances

#### Scenario: Accepting a proposal whose base revision moved
- **WHEN** the user accepts a proposal whose base revision is no longer current
- **THEN** the user is told it is stale and must be regenerated, and nothing is applied

#### Scenario: Rejecting a proposal
- **WHEN** the user rejects a proposal
- **THEN** it reaches a terminal rejected status and is not offered again

### Requirement: Tool output is untrusted data
Tool output SHALL be treated by clients as untrusted data rather than as instructions, and the
server MUST NOT emit content intended to direct a client's behavior.

#### Scenario: Free text in a read result
- **WHEN** a read result contains user-authored notes
- **THEN** the result is structured data and carries no directive to the client
