# 0009 — Platform, repository, and relying-party decisions

**Status:** Accepted
**Date:** 2026-09-17
**Discovery:** D-023, D-024, D-025, D-042, R-011, R-012, R-026
**Refines:** [0005](0005-supabase-behind-adapters.md) (without changing its decision)

## Context

Gates G-1 through G-4 were each waiting on an owner decision as well as on provisioning.
On 2026-09-17 Vladimir answered four of those questions:

- **D1.** Use Supabase **Free** for development only. Defer the production Supabase decision.
- **D2.** Use a **public** GitHub repository. The intent is to open-source the project.
- **D3.** Use the existing **Vercel** subscription for the web PWA. Decide MCP hosting after a
  compatibility spike.
- **D4.** Bind the WebAuthn relying-party ID to **`gym.vladimirli.com`**.

None of these authorizes provisioning, creating a remote, pushing, deploying, changing DNS,
handling credentials, or enrolling a passkey. Those remain separate, explicit actions.

## Decision

1. **Supabase.** A Supabase Free project is the development database and auth provider.
   Production stays on ADR-0005's terms: a Pro project, after the D-025 suitability check, and
   is not decided yet. Nothing is provisioned. The adapter contract suites must pass against the
   development project before any Supabase adapter is called working.
2. **Repository.** The GitHub repository will be public. It does not exist yet. A public
   repository makes CodeQL, dependency review, and artifact attestations available (G-6, G-7).
3. **Web hosting.** The web PWA deploys to Vercel under the existing subscription. The plan
   tier, project settings, deployment protection, and preview policy are not decided. The MCP
   server's host is chosen after a compatibility spike; until then G-4 stays open for MCP.
4. **Relying-party ID.** `gym.vladimirli.com`, never the apex and never inferred from a
   request. Passkeys are still never enrolled against a preview origin, and email one-time-code
   recovery must be verified before the first enrollment.

## Consequences

**Good.** Section 2 of the first vertical slice now has a named target for its adapter
contract suites, and section 3 has a fixed relying-party ID.

**Newly required.**

- **Licence review before publishing.** A public repository with open-source intent is a
  distribution plan. Condition 5 of the owner's licence decision (LIC-2026-09-16) says any
  distribution plan requires a new review before release. **Project licence:** MIT, chosen by
  Vladimir on 2026-09-24 (`LICENSE`, package `"license"` fields). The twelve LIC-2026-09-16
  exceptions are **not** yet re-reviewed for a public distribution plan; the repository must
  stay private until that review lands.
- **Public-repository hygiene.** Nothing private may be committed. The untracked `.lavish/`
  review artifacts stay out of Git.
- **Preview origins.** Vercel preview deployments are exactly the non-production origins that
  must refuse passkey enrollment.

**Still blocked.** Provisioning the Supabase Free project, creating the GitHub remote and its
ruleset, configuring Vercel and DNS, choosing the MCP host, and choosing production Supabase all
remain external gates (G-1 to G-4).
