## Purpose

Defines the telemetry signal for refused credentials: when one is recorded, the one closed value
it carries, and what it never carries. It observes authorization decisions and never changes them.

## ADDED Requirements

### Requirement: A refused credential is recorded as one closed outcome
The system SHALL record one `security.event` for each request in which a server-side component
refuses a presented credential, carrying exactly one attribute, `security.outcome`, whose value is
one of `mcp_token_rejected` and `synthetic_credential_rejected`. A value outside that set MUST be
dropped by the allowlist, and the event name MUST be on the closed event-name set.

#### Scenario: A malformed MCP token
- **WHEN** an MCP invocation presents a bearer value that cannot be verified
- **THEN** the invocation is refused
- **AND** one `security.event` with `security.outcome` of `mcp_token_rejected` is recorded

#### Scenario: A token for another audience
- **WHEN** an MCP invocation presents a verifiable token issued for a different resource
- **THEN** the invocation is refused and one `mcp_token_rejected` is recorded

#### Scenario: A token whose validity window is not acceptable
- **WHEN** an MCP invocation presents a token whose window is malformed, longer than 15 minutes,
  or has not started
- **THEN** each is refused and each records one `mcp_token_rejected`

#### Scenario: A revoked token
- **WHEN** the transport can tell that the presented token belongs to a revoked client
  authorization
- **THEN** the invocation is refused and one `mcp_token_rejected` is recorded

#### Scenario: A wrong synthetic credential
- **WHEN** the synthetic exchange receives a credential that matches no stored digest
- **THEN** it is refused and one `security.event` with `security.outcome` of
  `synthetic_credential_rejected` is recorded

#### Scenario: A synthetic credential past its end date
- **WHEN** the synthetic exchange receives a credential whose matching digest is past its end date
- **THEN** it is refused and one `synthetic_credential_rejected` is recorded

#### Scenario: A value outside the domain
- **WHEN** an event carries `security.outcome` with any other string, a number, a boolean or an
  object
- **THEN** the attribute is dropped

#### Scenario: An undeclared sibling event name
- **WHEN** telemetry records an event named after a credential, a client or a user
- **THEN** nothing is exported

### Requirement: Routine refusals are not recorded
The system MUST NOT record a `security.event` for an expired access token, a request with no
credential, a valid token that lacks the scope for the requested tool, a request for a tool that is
not exposed, or a request refused by the rate limiter.

#### Scenario: An expired token
- **WHEN** an MCP invocation presents a token that verified but whose expiry has passed
- **THEN** it is refused as expired and no `security.event` is recorded

#### Scenario: No credential
- **WHEN** a request reaches the MCP endpoint with no credential
- **THEN** it is refused and no `security.event` is recorded

#### Scenario: A genuine token without the scope
- **WHEN** an MCP invocation presents a valid token that lacks the scope the tool requires
- **THEN** it is refused as missing scope and no `security.event` is recorded

#### Scenario: A tool that is not exposed
- **WHEN** an MCP invocation names a tool outside the declared surface
- **THEN** it is refused and no `security.event` is recorded

#### Scenario: Rate limited
- **WHEN** an authorized client exceeds its invocation limit
- **THEN** it is told to retry later and no `security.event` is recorded

#### Scenario: Success
- **WHEN** an MCP invocation presents a valid token with the required scope, or the synthetic
  exchange receives a matching unexpired credential
- **THEN** no `security.event` is recorded

### Requirement: The event carries no identity, secret or reason
A `security.event` MUST carry `security.outcome` and nothing else that identifies a client, user,
token, credential, address or reason. Its export MUST NOT contain a token, a credential, a client
id, a subject, an email address, a network address, a user agent, a header, a URL or the reason the
credential was refused. It MUST NOT carry a `synthetic` attribute, because a refused credential has
not authenticated.

#### Scenario: Sentinel material beside the outcome
- **WHEN** a refusal is recorded while the request carries a sentinel token, client id, email
  address and user agent
- **THEN** the serialized export contains `security.outcome` and none of the sentinels, in any label,
  resource attribute, header or body

#### Scenario: Every refusal reason produces the same shape
- **WHEN** the same outcome is recorded for a bad signature, a wrong audience and a window that is
  too long
- **THEN** the three exported events are indistinguishable from one another

#### Scenario: No synthetic label
- **WHEN** a refusal of the synthetic credential is recorded
- **THEN** the exported event has no `synthetic` attribute

### Requirement: Telemetry does not alter an authorization decision
Recording a `security.event` MUST NOT change whether a request is authorized, what it is told, or
how long the refusal takes beyond the recording call itself. A failure, a delay or an absent
exporter MUST NOT turn a refusal into an acceptance.

#### Scenario: Telemetry throws
- **WHEN** recording the event throws while a bad token is being refused
- **THEN** the request is refused exactly as it is when telemetry is healthy

#### Scenario: No exporter configured
- **WHEN** telemetry is the default discarding exporter and a bad token is presented
- **THEN** the request is refused and nothing is exported

#### Scenario: The decision does not depend on the event
- **WHEN** the same set of requests is run with telemetry healthy and with telemetry disabled
- **THEN** each request receives the same authorization result in both runs

### Requirement: The signal comes from a server-side component only
A `security.event` MUST be recorded by the component that refused the credential, after it has
decided. A report from a browser or any client MUST NOT be exported as a `security.event`, and a
client MUST NOT be able to cause or suppress one other than by presenting a credential.

#### Scenario: A client reports a sign-in failure
- **WHEN** a browser sends a request that claims a sign-in failed
- **THEN** no `security.event` is recorded, and the request has no route that would accept it

#### Scenario: A body naming an outcome
- **WHEN** a request body to the MCP endpoint or the synthetic exchange carries a `security.outcome`
  field
- **THEN** it is refused by the closed schema and never read as the outcome

### Requirement: A refused credential raises an alert on both paths
Once the alert-as-code task exists, the system SHALL raise an alert for an increase of
`security.event` of any outcome within 15 minutes, routed to both independent notification paths.
The rule MUST treat the absence of data as healthy. Its payload MUST derive only from allowlisted
attributes.

#### Scenario: A refused credential in the drill
- **WHEN** the drill presents a bad MCP token to a non-production stack
- **THEN** the alert reaches Telegram and the signed webhook, each with the other muted in turn

#### Scenario: A routine refusal in the drill
- **WHEN** the drill presents an expired token and a token without the required scope
- **THEN** no alert is raised

#### Scenario: No refusals
- **WHEN** no credential has been refused in the evaluation window
- **THEN** the rule is not firing, and its absence of data is not reported as a fault

### Requirement: Interactive sign-in failures are not reported until observable
The system MUST NOT export a signal for a refused interactive email-code verification until a
server-side observation point for it has been approved by Vladimir. This change MUST NOT narrow
D-049, and the authentication class MUST be reported as partial for the interactive path while it
is unobserved.

#### Scenario: A refused email code
- **WHEN** a person enters a wrong email code in the browser
- **THEN** the product records no `security.event`

#### Scenario: The gate is described honestly
- **WHEN** `docs/external-gates.md` describes G-5 after this change ships
- **THEN** it states that the interactive sign-in path has no failed-attempt signal, and does not
  state that the authentication class is covered
