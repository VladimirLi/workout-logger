# Security Policy

**Status:** Normative. Changes to this file are guardrail changes — see
[AGENTS.md](AGENTS.md) § Guardrail self-modification.
**Source:** Promoted from [docs/discovery/decision-record.md](docs/discovery/decision-record.md).

## Reporting a vulnerability

This is a private, single-user project with no public disclosure process yet. Report
security issues directly to the repository owner (vladde1991@gmail.com). Do not open a public
issue. If an external user is ever onboarded, this section must be replaced with a real
coordinated-disclosure policy before onboarding.

## Trust boundaries

| Boundary | Principal | Authority |
|---|---|---|
| Browser session | Vladimir | Full read/write on own data via authenticated app routes |
| Remote MCP | External AI agent client | Immediate reads; **proposal creation only** — no direct mutation |
| Service role | Server-side code only | Never reaches the browser bundle, service-worker cache, logs, or traces |
| CI gatekeeper | GitHub Actions | Executes checks; publishes immutable results; cannot approve its own work |
| Release automation | OIDC, short-lived | Deploys an attested merge commit only |
| Incident agent | Read sanitized evidence | Opens fix PRs; **cannot mutate production** |

No principal may both implement a candidate and attest its independent review or CI
result (R-023).

## Web authentication (D-024, R-012)

- Managed passwordless authentication. Email OTP is the guaranteed recovery path;
  passkeys are an optional daily-convenience sign-in.
- The production apex domain is `gym.vladimirli.com`. The WebAuthn relying-party ID binds
  to `gym.vladimirli.com` unless the origin policy intentionally allows sibling
  subdomains.
- **Never enroll production credentials against a provider preview domain.** Changing the
  RP ID invalidates every enrolled credential. DNS and origin configuration must be
  confirmed before the first production passkey enrollment. This is an external gate —
  see [docs/external-gates.md](docs/external-gates.md).

## MCP authorization (D-019, D-020, R-020)

The remote MCP server is an OAuth-protected resource implementing the current MCP
authorization specification:

- HTTPS only; protected-resource metadata and authorization-server discovery.
- Audience validation, exact redirect matching, PKCE where applicable.
- **No token passthrough.** The MCP credential is separate from browser identity.
- "One token" (D-020) means **one revocable client authorization**, not a wildcard or
  non-expiring bearer secret.
- Scopes `workout:read` and `proposal:create` are granted together initially, and are
  still enforced separately server-side.
- Access tokens expire within **15 minutes**. Refresh credentials rotate, are encrypted in
  a managed secret store, and are revocable with propagation within **5 minutes**.
- Tokens must never appear in URLs, logs, repository files, browser storage, or process
  arguments.

### MCP tool surface constraints (R-021)

Exposed: read resources for product capabilities, active-plan revision, scheduled
sessions, completed-session summaries, exercise definitions, and proposal status; proposal
tools for plan replacement, scheduled-session change, exercise-prescription change, and
completed-session correction.

**Never exposed:** a generic SQL or query tool, an arbitrary patch operation, direct
delete, deployment, credential, or administration tool.

All schemas are closed and versioned, reject unknown fields, validate bounds, cap result
size, paginate history, and rate-limit calls. Tool outputs are untrusted data to clients.
Every invocation is re-authorized.

## Database authorization (R-013)

- RLS and explicit grants on **every** table or view reachable through an exposed schema.
- Tests must prove deny-by-default for unauthenticated and wrong-user identities, for
  every operation. A missing deny test is a gate failure, not a nit.
- Columns used by RLS policies are indexed.
- Any `SECURITY DEFINER` function pins `search_path` safely.

## Secrets

- The repository contains **environment examples only**. No real secret, key, token, DSN,
  or connection string is ever committed.
- Secret scanning runs in the required gate (`pnpm test:secrets` locally over the working tree including dotfiles, and gitleaks over full history in CI).
- `.env*` files are gitignored except `*.example`.
- A committed secret is an incident: rotate first, scrub second.

## Supply chain (D-039, R-026, R-029)

- Block **high and critical** runtime vulnerabilities and prohibited licenses.
- Allowed licenses without exception: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
  0BSD, Zlib, BlueOak-1.0.0, Python-2.0, Unlicense.
- Rejected: AGPL, SSPL, BUSL, Commons Clause, Elastic License 2.0, non-commercial
  licenses, the JSON license, and unresolved/unknown licenses in distributed runtime
  dependencies.
- LGPL, MPL, EPL, CDDL, GPL, and dual-license expressions require review based on actual
  linkage and distribution. Dev-only tooling is evaluated separately from shipped code.
- Every exception records component/version, SPDX expression, use and linkage, lack of
  alternative, obligations, approver, and a review date no more than 12 months out. See
  [docs/license-policy.md](docs/license-policy.md).
- Third-party GitHub Actions are pinned to full commit SHAs.
- An SPDX or CycloneDX SBOM and signed provenance are generated for every release; the
  attestation is verified before deployment. Target SLSA Build Level 2 for the first
  release.

## Agent execution isolation (R-024)

Agent runs execute in ephemeral isolated workspaces with no production credentials and
default-denied network access except declared endpoints. Runner-enforced limits: **30
minutes** and **200,000 tokens** per run; exceed them and the task checkpoints and is
marked blocked, never silently overrun. Cost limits are runner configuration, not prompt
instructions.

Source code may be sent to approved third-party model providers. Production secrets,
credentials, personal workout data, and raw production evidence may not be, regardless of
provider approval.

## Privacy

- Operational telemetry never contains workout content or agent rationale — see
  [OBSERVABILITY.md](OBSERVABILITY.md).
- Agent rationale is authoritative proposal data, not telemetry.
- Proposal artifacts, audit events, and revision history are retained until the user
  explicitly deletes them (D-048).
- Deletion is a 30-day recoverable period followed by verified hard deletion. The UI must
  explain when expired backup generations stop containing deleted data (R-014).
