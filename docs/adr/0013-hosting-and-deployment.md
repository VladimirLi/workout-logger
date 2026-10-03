# 0013 — Hosting, environments, deploy identity, and rollback

**Status:** Accepted 2026-09-30 — direction approved by Vladimir on VLA-253 (decisions 2 and 3 below). Decisions 1 and 5 are deferred until there are real users, decision 7 is resolved (the repository is public), and decisions 4 and 6 remain open (see [Open decisions](#open-decisions-for-vladimir))
**Date:** 2026-09-30
**Discovery:** D-023, D-042, D-043, D-044, D-045, D-046, R-015, R-016, R-017, R-020
**Relates to:** [0009](0009-platform-repository-and-relying-party-decisions.md), [0011](0011-supabase-development-project.md), [0012](0012-one-trusted-write-boundary.md), gates G-2, G-3, G-4, G-7, G-8 in [external-gates.md](../external-gates.md)
**Spike:** [MCP hosting spike](../discovery/mcp-hosting-spike.md)

## Context

ADR-0009 (D3) chose Vercel for the web PWA and deferred MCP hosting to a compatibility spike.
Nothing is configured, deployed, or paid for. D-042 requires every merged change to deploy
automatically; D-043 requires automatic rollback on failed post-deployment health or synthetic
verification; AGENTS.md gives release automation the job of deploying an attested merge commit
"via short-lived OIDC".

Two facts found while researching this ADR shape the design (both from Vercel's documentation
as of 2026-09-30, neither exercised against a real account):

1. **Vercel does not accept GitHub Actions OIDC for its API or CLI.** Vercel's OIDC is
   outbound (Vercel to your cloud) plus *Trusted Sources*, which lets a GitHub Actions OIDC
   token pass Deployment Protection to reach a protected deployment. Promoting, rolling back,
   or deploying from CI still needs a Vercel access token. "Short-lived OIDC" cannot be met
   literally for the deploy action itself.
2. **The Hobby plan is restricted to non-commercial, personal use** and caps function duration
   at 300 s; Pro raises it to 800 s and adds spend management and longer logs. ADR-0009 says
   only "the existing subscription", so the tier is unrecorded.

## Decision

### 1. Environments: `preview` and `production`. No staging.

| | `preview` | `production` |
|---|---|---|
| Created | One per pull request, by Vercel's Git integration | From `main`, as a *staged* deployment, then promoted |
| Origin | `*.vercel.app`, behind Deployment Protection | `gym.vladimirli.com` (G-3) |
| Supabase | The existing dev project (`workout-logger-dev`, ADR-0011) | A separate Supabase Pro project (G-2, not yet created) |
| Data | Disposable development data only | Vladimir's data |
| Passkeys | **Never enrolled.** Email OTP only | The only origin passkeys are enrolled against (ADR-0009 D4) |

There is no staging environment. Its job is done by the staged production deployment (built
and reachable at its own URL, not yet serving `gym.vladimirli.com`) plus synthetic verification
against an isolated account (D-046). Consequence: the first time code meets the production
database is the staged smoke check, which is why the migration order in section 4 matters.

Previews share one dev database. Concurrent previews can interfere with each other's data.
That is accepted for a single-user project; it is not acceptable once there is a second user.

### 2. Web: Vercel

- One Vercel project for `apps/web`, connected through Vercel's GitHub integration, Fluid
  compute (the default for new projects), Node.js 22.
- Production custom domains are **not** auto-assigned (Vercel's "Auto-assign Custom Production
  Domains" setting off). A push to `main` therefore builds a staged deployment that serves no
  traffic until the release job promotes it (section 3). This is the mechanism that lets CI,
  not Vercel, decide whether a build goes live.
- Preview deployments are protected by Vercel Authentication. The release job reaches protected
  staged URLs with a GitHub OIDC token via Trusted Sources (`repository`, `ref: refs/heads/main`,
  and a `production` GitHub environment), with no shared secret.
- The plan tier is deferred until there are real users besides Vladimir (his answer on VLA-479,
  2026-10-03), so the first deployment uses Vercel Hobby. The design works on either tier; Pro
  adds 800 s functions, a spend limit, and one day of logs, and is Vladimir's spend when needed.

### 3. Deploy identity: GitHub OIDC where Vercel accepts it, one scoped token where it does not

| Action | Identity | Long-lived secret? |
|---|---|---|
| Build preview (per PR) and staged production build | Vercel's GitHub integration | No. Nothing stored in GitHub |
| Reach a protected staged or preview URL from CI | GitHub Actions OIDC, Vercel Trusted Sources | No |
| Confirm the merge commit passed `verify` | `GITHUB_TOKEN`, read-only `checks`/`statuses` | No |
| `vercel promote` / `vercel rollback` | **Vercel access token** | **Yes — one** |

The token is stored as a secret of a GitHub environment named `production`, restricted to the
`main` branch, and read only by the release job. It is not available to implementation,
review, or QA agents (R-023). Its scope is the least Vercel offers; whether Vercel can scope a
token to one project rather than the whole team was not confirmed, and is part of the approval.

**This deviates from the original "short-lived OIDC" wording in AGENTS.md and G-4. Vladimir accepted
the deviation on 2026-09-30; AGENTS.md and G-4 are amended accordingly.** It was recommended
because the alternatives are worse for what D-043 requires:

- *Auto-assign on, no token.* Every green Vercel build goes live whether or not CI passed and
  the platform runs no post-deploy verification, so D-043 cannot be implemented.
- *Build in GitHub Actions with `vercel deploy --prebuilt`.* Allows binding the artifact to a
  CI result, but needs the same token for deploy as well as promote and rollback, and adds a
  second build pipeline.

If Vladimir does not accept a static token, the fallback is the first alternative with
rollback done manually, which fails D-043. That would be a decision to relax D-043, not a
technical option.

G-7 is unaffected by this decision. The repository is public (Vladimir, VLA-479, 2026-10-03),
and artifact attestations are available in public repositories on all plans, so the plan
limitation no longer applies. Until the attestation step is built and verified (G-7), the
release job binds "attested" to the commit SHA (same SHA passed `verify`).

**Release job** (`.github/workflows/`, a guardrail path, so its own PR, not written here):

1. Trigger on `repository_dispatch` `vercel.deployment.success` for the production target.
2. Confirm the `verify` check for that exact SHA is green. **Fail closed** if it is missing,
   pending, or red.
3. If the commit carries migrations: run the pre-migration backup ([runbook](../runbooks/pre-migration-backup.md),
   G-8), then apply the expansion. Any failure stops the job before promotion.
4. Run the pre-promotion checks against the staged URL: health and the D-045 synthetic suite
   using the isolated synthetic account.
5. `vercel promote` the staged deployment.
6. Run the synthetic suite against `gym.vladimirli.com`. On any failure, `vercel rollback`, then
   re-run the checks against the restored deployment and page the incident path (G-5).

### 4. Rollback

- **App:** Vercel Instant Rollback to the previous production deployment, automatic on a failed
  step 6 above (D-043). A rollback is a domain reassignment, not a rebuild.
- **Schema:** never rolled back. Migrations are expand-contract (R-016), so the previous app
  version runs against the expanded schema. Only the application moves. No down-migrations
  (R-017). Destructive data errors are fixed forward or by a verified restore (G-8).
- **Contract migrations** ship in a later release only after telemetry shows the old path is
  unused, so a rollback never targets an app that needs a column already dropped.
- **After a rollback**, Vercel stops auto-assigning production domains until a deployment is
  promoted explicitly. This design already promotes explicitly, so the behaviour is consistent,
  but the release job must not assume a later `main` push goes live on its own: it always runs
  step 5.
- **Failure of the rollback itself** (token revoked, Vercel API down) is the residual risk: the
  release job fails loudly and alerts, and the manual action is `vercel rollback` or the dashboard.
  This has not been drilled. G-4 stays open until it is.

### 5. Environment variables by environment

Names are from `.env.example`. No values are committed.

| Variable | `preview` | `production` | Exposure |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | dev project URL | production project URL | Browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | dev publishable key | production publishable key | Browser |
| `SUPABASE_SECRET_KEY` | dev secret key, Preview scope only | production secret key, Production scope only | **Server only**, marked Sensitive |
| `NEXT_PUBLIC_APP_ORIGIN` | the deployment's own URL | `https://gym.vladimirli.com` | Browser |
| `WEBAUTHN_RELYING_PARTY_ID` | unset: passkeys disabled | `gym.vladimirli.com` | Server |
| `MCP_RESOURCE_IDENTIFIER` | unset | production MCP URL (host: open decision) | Server |
| `MCP_AUTHORIZATION_SERVER` | unset | Supabase Auth issuer of the production project | Server |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | empty (no export) | backend endpoint (G-5) | Server |
| `OTEL_SERVICE_NAME` | `workout-web` | `workout-web` | Server |
| `DEPLOYMENT_ENVIRONMENT` | `preview` | `production` | Server |

Rules:

- `SUPABASE_SECRET_KEY` is set only as a server environment variable, never with a
  `NEXT_PUBLIC_` prefix, never in the `Development` scope, and never in GitHub secrets. The
  existing `scripts/bundle-secrets.mjs` build check remains the enforcement.
- The production key exists in the Production scope only. A preview build, which runs code
  from an unmerged PR, cannot read it. The dev key that previews *do* hold reaches only
  disposable data.
- Production values are entered by Vladimir directly in the Vercel and Supabase dashboards.
  Agents are given no production credential (AGENTS.md, execution isolation).
- The MCP host, if it is not Vercel, gets its own copy of the four MCP/Supabase variables it
  needs, under the same rules.

### 6. MCP hosting: recommended, not decided

The web decision does not depend on this. The [spike](../discovery/mcp-hosting-spike.md)
recommends **a second Vercel project for `apps/mcp`** (Vercel Functions, same release job and
rollback mechanism), with a small container on Fly.io as the fallback if a requirement emerges
that Vercel's 800 s function limit or request model cannot meet. **Vladimir approves the final
MCP host.** Until then `apps/mcp` remains a skeleton and nothing in this ADR provisions it.

## Consequences

**Good.**
- Web hosting is decided and its deploy path is fully specified; a follow-up can implement it
  once the Vercel project exists.
- One deploy mechanism and one rollback mechanism for web and, if approved, MCP.
- The only long-lived deploy credential is one token, held only by the release job.
- Schema and app roll back independently, which is what makes D-043 safe with D-044.

**Bad.**
- A static token is a long-lived credential, which the original AGENTS.md wording ruled out.
  Vladimir accepted this on 2026-09-30 and AGENTS.md's release-automation row was amended in
  the same PR.
- Previews share one dev database and can interfere with each other.
- There is no place to run migrations against production-shaped data before production.
- Promotion depends on a `repository_dispatch` from the Vercel integration reaching GitHub.
  If it is dropped, a good build waits, staged and unserved. That fails safe, not open.
- Rollback is unproven until drilled.

**Still closed.** No Vercel project, token, domain, DNS record, or production Supabase project
exists. This ADR provisions nothing.

## Open decisions for Vladimir

One list, also in the [spike](../discovery/mcp-hosting-spike.md#open-decisions-for-vladimir).
Each needs your action because it is spend, an account, DNS, a credential, or a change to a file
agents may not edit.

Resolved by Vladimir's approval of the direction on VLA-253 (2026-09-30): **2** (token accepted)
and **3** (MCP host: second Vercel project, Fly.io as fallback). Answered by Vladimir on
VLA-479 (2026-10-03): **1** and **5** are deferred until there are real users besides him, and
**7** is resolved (the repository is public). Still open: **4, 6**. Nothing below is provisioned
or paid for.

1. **Deferred until real users: Vercel plan tier.** Vladimir, VLA-479, 2026-10-03: not yet; pay
   when there are real users besides him. Start on Hobby (free, non-commercial personal use,
   300 s functions); Pro ($20/month, 800 s functions, spend management) later.
2. **Resolved: accepted.** One scoped Vercel token in place of OIDC for promote and rollback (section 3), and
   amend AGENTS.md's release-automation row and the G-4 "done when" accordingly.
3. **Resolved: second Vercel project.** Fly.io stays the fallback if the MCP server needs
   long-lived streaming, or Vercel cold starts prove unacceptable in a drill.
4. **MCP SDK line.** Stay on `@modelcontextprotocol/sdk` 1.x (current) or move to v2
   (`@modelcontextprotocol/server`, `mcp-handler` 2.x). Whether 1.x supports spec 2026-07-28 was
   not established; see the spike.
5. **Deferred until real users: production Supabase Pro project** (about $25/month). Vladimir,
   VLA-479, 2026-10-03: not yet. Revoking the default privileges on `anon` and `authenticated`
   before it holds data (ADR-0011) still applies whenever it is created.
6. **Domain and DNS** for `gym.vladimirli.com` (G-3), and creating the Vercel project, the
   `production` GitHub environment, the token, and the Trusted Sources entry. All are yours to
   create; none was attempted.
7. **Resolved: the repository is public** (Vladimir, VLA-479, 2026-10-03). Artifact attestation
   (G-7) is available; no visibility change is needed.
