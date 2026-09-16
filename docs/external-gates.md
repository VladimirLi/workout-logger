# External setup gates

**Status:** Normative checklist. Nothing here has been performed.

Every item below requires the **user's authorization** and credentials for an external
service. No agent provisions any of it. This repository deliberately contains no secrets,
no cloud resources, no DNS records, no GitHub remote, and no deployment.

Each gate states what is unverified, what the repository ships instead, and what "done"
means.

---

## G-1 — GitHub remote and repository ruleset

**Status:** not performed. No remote exists.

**Required (R-026, ADR-0006).** A ruleset on the default branch with: pull requests only;
required status checks from named trusted sources; stale review dismissal; linear history;
signed commits; no force-push; no deletion; no routine bypass actor.

**What ships now.** `.github/workflows/*` define the checks. `.github/CODEOWNERS`,
`.github/pull_request_template.md`, and `docs/branch-protection.md` define the intended
rules.

**Unverified boundary.** Branch protection is GitHub-side state. Until the ruleset is
applied, the workflows are advisory. "CI is authoritative" is documented intent, not an
enforced fact, until this gate closes.

**Done when.** `gh api repos/{owner}/{repo}/rulesets` returns the ruleset in
`docs/branch-protection.md` with `enforcement: active`.

---

## G-2 — Supabase project

**Status:** not performed. No project, no keys, no schema.

**Required (ADR-0005, R-011, R-013).** A Supabase **Pro** project — the free tier pauses
and is unsuitable for production. RLS and explicit grants on every exposed table or view.
Service-role credentials server-side only.

**What ships now.** `packages/adapters-supabase` is a port-implementing skeleton with no
credentials. `.env.example` lists required variable names with empty values.

**Unverified boundary.** No connection has been made. No RLS policy has been executed or
tested. Deny-by-default proofs cannot run without a project.

**Done when.** A Pro project exists, migrations apply, and the adapter contract suite plus
the RLS deny-by-default suite pass against it in CI with repository secrets.

**Blocking check before relying on it.** Confirm no blocking requirement has emerged that
makes Supabase unsuitable (D-025). Record the outcome in an ADR.

---

## G-3 — Production domain, DNS, and WebAuthn relying-party ID

**Status:** not performed.

**Required (R-012).** Apex/host `gym.vladimirli.com`. Decide whether the WebAuthn RP ID
binds to `gym.vladimirli.com` or to `vladimirli.com` (only if the origin policy
intentionally allows sibling subdomains).

**One-way door.** Changing the RP ID **invalidates every enrolled passkey**. Production
credentials must never be enrolled against a provider preview domain. DNS and origin
configuration are confirmed *before* the first production enrollment.

**Done when.** DNS resolves, HTTPS serves the production origin, the RP ID decision is
recorded in an ADR, and email OTP recovery is verified working before any passkey is
enrolled.

---

## G-4 — Hosting and deployment

**Status:** not performed. No deployment target chosen.

**Required (D-023, D-042, D-043).** Private, authenticated, single-user HTTPS hosting
reachable from a phone. Automatic deploy on merge. Automatic rollback on failed
post-deployment health or synthetic verification.

**What ships now.** Nothing deploys. `apps/web` and `apps/mcp` build locally.

**Unverified boundary.** Rollback automation cannot be written meaningfully before the
platform is chosen.

**Done when.** A target is chosen and recorded in an ADR, deploys are automatic from an
attested merge commit via short-lived OIDC, and a rollback has been drilled.

---

## G-5 — Telemetry backend and alerting

**Status:** not performed.

**Required (D-049, R-018, R-019).** An OpenTelemetry-compatible backend. Dual-path
alerting: an independent alert manager paging Telegram directly, **and** independently
sending a signed metadata-only webhook to a narrowly scoped Hermes incident workflow.
Hermes is not in the paging critical path.

**Provisional provider.** Grafana Cloud Alerting, because it supports both Telegram
contact points and generic webhooks. Pricing and operational fit are confirmed at setup.

**What ships now.** `packages/observability` owns the allowlist and the approved API. The
telemetry canary test runs locally against the in-process exporter and proves sentinel
workout content is dropped — that part is **verified without credentials**.

**Unverified boundary.** Export to a real backend, alert routing, and Telegram delivery.

**Done when.** Both alert paths are drilled independently, each with the other disabled,
and the canary passes against the real exporter configuration.

---

## G-6 — Secret scanning and code scanning services

**Status:** partially verifiable.

**Verified locally.** Secret scanning runs in `pnpm verify` against the working tree and
full history. This gate is real today.

**Unverified boundary — and it is wider than "needs a remote".** Repository *visibility
and plan* decide whether two of these three jobs can run at all:

| Job | Public repo | Personal **private** repo |
|---|---|---|
| `gitleaks` | works | **works** — free for personal accounts; only organizations need a `GITLEAKS_LICENSE` |
| `codeql` | works | **not licensed.** The CodeQL terms cover open-source repositories on GitHub and private repositories owned by an **organization** with GitHub Advanced Security. A user-owned private repository qualifies for neither |
| `dependency-review` | works | **unavailable.** It needs the dependency graph and is offered for public repositories, or organization-owned private repositories with GHAS |

So if this repository is created private under a personal account, **only the gitleaks job
functions**, and `pnpm test:deps`, `pnpm test:licenses`, and `pnpm test:secrets` are the
operative controls. Both jobs are kept in the workflow, with the limitation recorded in the
job, rather than deleted — deleting them would erase the fact that this coverage is missing.

GitHub also recommends CodeQL **default setup** (a repository setting) over an
advanced-setup workflow for JavaScript/TypeScript. If the repository ends up eligible,
prefer default setup and delete the `codeql` job rather than maintaining YAML.

**Done when.** Push protection is on; and either the repository is public or
organization-owned with GHAS so `codeql` and `dependency-review` function, or their absence
is formally accepted in writing and the local gates are acknowledged as the only coverage.

---

## G-7 — Release provenance and SBOM publication

**Status:** partially verifiable.

**Verified locally.** SBOM generation runs offline from the committed lockfile.

**Unverified boundary.** `actions/attest` requires GitHub OIDC and the `id-token`,
`attestations`, and `artifact-metadata` write permissions — it cannot run without a remote.
Attestation verification before deploy depends on G-4.

**Plan limitation.** Artifact attestations are available in public repositories on all
current plans. Using them in a **private or internal** repository requires GitHub Enterprise
Cloud. A personal private repository cannot produce them, which means SLSA Build Level 2 is
unreachable there and the SBOM ships unattested. That is a plan decision, not a code change.

**Done when.** A release produces a verifiable attestation, deployment verifies it before
promoting, and the release meets SLSA Build Level 2.

---

## G-8 — Pre-migration backup path

**Status:** not performed. Depends on G-2.

**Required (R-015, R-017).** Before **every** production migration: encrypted logical
Postgres dump, stored outside the application provider, verified readable, checksum
recorded against the release, **fail closed** if any step fails.

**What ships now.** `pnpm test:migrations` validates migration files and fails honestly
once migrations exist. The backup runbook is `docs/runbooks/pre-migration-backup.md`.

**Unverified boundary.** No dump has been taken, stored, or restored.

**Done when.** A restore drill into an isolated project has succeeded at least once and
the checksum-to-release binding is automated.

**Explicitly accepted risk.** No PITR and no scheduled backups while single-user. Total
loss of data created *between* migrations is accepted. Revisit before onboarding any
external user.

---

## G-9 — Agent identities and credentials

**Status:** not performed.

**Required (R-023, R-024).** Separate identities and least-privilege credentials for the
product/spec agent, implementation agent, independent review agent, CI gatekeeper, release
automation, and incident agent. No principal both implements a candidate and attests its
review or CI result. Ephemeral isolated workspaces, default-denied egress, 30-minute and
200,000-token per-run limits enforced by the runner.

**Done when.** Each role has a distinct credential, the review approval is a required
status check bound to an exact SHA, and the runner enforces the limits as configuration.

---

## G-10 — Design system acceptance

**Status:** not performed. **Blocks substantive UI work.**

**Required (ADR-0007).** [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) must reach status
`Accepted` before any change implementing substantive UI may merge.

**Not an external-service gate** — it needs no credentials. It is listed here because it
is a human decision an agent must not make on its own.

**Done when.** The design system is decided iteratively, `DESIGN_SYSTEM.md` records it,
an ADR is written, and visual-regression baselines exist.

---

## G-11 — License exception sign-off

**Status: CLOSED 2026-09-16, conditionally, through 2027-09-16.**

**Decision** (LIC-2026-09-16), recorded verbatim from the owner, Vladimir:

> Approve all 12 with the stated conditions through 2027-09-16.

All twelve exact `component@version` entries in [license-policy.md](license-policy.md) now
name **Vladimir** as approver, backed by that decision record in
`scripts/license-policy.json`. No allowlist was widened and no future version was approved.
A thirteenth candidate — `@img/sharp-libvips-darwin-arm64`, LGPL-3.0-or-later — had already
been eliminated rather than approved.

**Conditions accepted by the owner:**

1. product remains privately hosted
2. no npm package, binary, desktop bundle, or redistributable build is published
3. dependencies remain unmodified
4. CI verifies exact package versions and scopes against the ledger
5. any distribution plan, material dependency change, or expired review date blocks release and requires new review

**What reopens this gate.** Any of the following makes `pnpm test:licenses` fail and requires
new owner review before release:

- a workspace package becoming publishable, a publish command or step, a binary or desktop
  bundler, or a standalone-executable build;
- a patch, override, resolution, or pnpmfile touching an excepted component;
- an excepted component changing version, scope, or licence expression, disappearing, or
  becoming unnecessary;
- a new non-allowed licence anywhere in the tree;
- the end of 2027-09-16 UTC.

**Unverified boundary.** A distribution plan that leaves no trace in the repository cannot be
detected mechanically. The condition is binding regardless, and is recorded in
license-policy.md for that reason.
