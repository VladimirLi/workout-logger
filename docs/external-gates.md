# External setup gates

**Status:** Normative checklist. One cloud resource exists: a Supabase **Free development**
project, authorised on 2026-09-18 for development only (G-2, ADR-0011). No remote, no DNS
record, no deployment, and nothing in production.
Owner decisions recorded here (for example ADR-0009) do not perform any gate.

Every item below requires the **user's authorization** and credentials for an external
service. No agent provisions any of it. This repository deliberately contains no secrets,
no cloud resources, no DNS records, no GitHub remote, and no deployment.

Each gate states what is unverified, what the repository ships instead, and what "done"
means.

---

## G-1 — GitHub remote and repository ruleset

**Status:** not performed. No remote exists.

**Decided 2026-09-17 (ADR-0009, D2).** The repository will be **public**, with the intent to
open-source the project. Before it is made public, the licence review that LIC-2026-09-16
condition 5 requires for a distribution plan must be done, and the project licence chosen.

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

**Status:** partly performed. A Free **development** project exists with the schema applied
and deny-by-default measured (2026-09-18, ADR-0011). Production is not performed: no Pro
project, no production data, no CI secrets.

**Decided 2026-09-17 (ADR-0009, D1).** Supabase **Free** for development only. The production
decision is deferred, and the Pro requirement below still applies to production.

**Required (ADR-0005, R-011, R-013).** A Supabase **Pro** project — the free tier pauses
and is unsuitable for production. RLS and explicit grants on every exposed table or view.
Service-role credentials server-side only.

**What ships now.** `packages/adapters-supabase` implements the proposal store and the workout
transport against a real development project, on `fetch` with no added dependency.
`.env.example` lists required variable names with empty values; the values live in a gitignored
`.env.local`.

**Verified against a development project, not against production.** Migrations apply, and the
policies and privileges have been executed rather than reasoned about: the anonymous half of
deny-by-default (`scripts/check-rls.mjs`), the wrong-user half with two signed-in identities
(`pnpm test:provider`), and the deployed privileges, function owners and pinned `search_path`
(`node scripts/check-db-boundary.mjs`). Nothing here has run against production, which does not
exist.

**Done when.** A Pro project exists, migrations apply, and the adapter contract suite plus
the deny-by-default suites pass against it in CI with repository secrets. The suites exist and
pass locally; CI cannot run them until repository secrets exist, which is what remains.

**Blocking check before relying on it.** Confirm no blocking requirement has emerged that
makes Supabase unsuitable (D-025). Record the outcome in an ADR.
Done: 2026-09-18, ADR-0011. No blocking requirement emerged. Checked against a running
database rather than reasoned about: migrations apply, RLS is enabled and forced on all six
exposed tables with an owner policy each, every anonymous read and write is refused with 401
(`scripts/check-rls.mjs`), and the one security-definer function in `public` pins its
`search_path`. One finding recorded for production: Supabase's default privileges grant future
tables in `public` to anon, so deny-by-default there rests on RLS rather than on grants.

Corrected on 2026-09-19: that finding was understated. The same default privileges grant ALL to
`authenticated`, which is the role a browser holds, and the migration gate only asked for a
revocation from `PUBLIC` and `anon` - so every signed-in user could write all six tables
directly, past the functions that own those writes. Closed by migration 20260919140000
(`REVOKE ALL PRIVILEGES`, then `GRANT SELECT`), by a gate that replays every privilege statement
from that default and fails unless the final state is exactly SELECT, and by a check that reads
the deployed schema back. See ADR-0012.

**Development project, 2026-09-18.** Vladimir authorised one Supabase **Free** project for
development only: `workout-logger-dev`, ref `vrhukqvrnlejvmpefmxl`, `eu-west-1`,
`ACTIVE_HEALTHY`, Postgres 17.6.1, linked by Supabase CLI 2.117.0. The committed migration is
applied and verified by read-back. Credentials live in a gitignored `.env.local` and have never
been printed. Not authorised, and not done: production resources, any paid upgrade, production
data, DNS, passkey enrollment, and any deployment.

**Still open for this gate.** The Pro project, CI secrets, and therefore the provider suites
running in CI. Both halves of deny-by-default are proved locally against the development
project: the anonymous half by `scripts/check-rls.mjs`, and the wrong-user half by
`wrong-user.provider.ts`, which signs two development identities in through the same
verification exchange the product's email code flow will use.

---

## G-3 — Production domain, DNS, and WebAuthn relying-party ID

**Status:** not performed. The RP ID is decided; DNS, origin, and enrollment are not done.

**Required (R-012).** Host `gym.vladimirli.com`. **The WebAuthn RP ID is
`gym.vladimirli.com`**, decided by Vladimir on 2026-09-17 (ADR-0009, D4).

**One-way door.** Changing the RP ID **invalidates every enrolled passkey**. Production
credentials must never be enrolled against a provider preview domain. DNS and origin
configuration are confirmed *before* the first production enrollment.

**Done when.** DNS resolves, HTTPS serves the production origin, the deployment
configuration carries the recorded RP ID, and email OTP recovery is verified working before
any passkey is enrolled. (The RP ID decision is recorded in ADR-0009.)

---

## G-4 — Hosting and deployment

**Status:** not performed. The web target is chosen; nothing is configured or deployed.

**Decided 2026-09-17 (ADR-0009, D3).** The web PWA uses Vercel under the existing
subscription; the plan tier and project settings are not decided. MCP hosting is decided after
a compatibility spike.

**Required (D-023, D-042, D-043).** Private, authenticated, single-user HTTPS hosting
reachable from a phone. Automatic deploy on merge. Automatic rollback on failed
post-deployment health or synthetic verification.

**What ships now.** Nothing deploys. `apps/web` and `apps/mcp` build locally.

**Unverified boundary.** Rollback automation cannot be written meaningfully before the
platform is chosen.

**Done when.** Targets for both the web app and the MCP server are recorded in an ADR, deploys
are automatic from an attested merge commit via short-lived OIDC, and a rollback has been
drilled.

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

## G-10 — Design system acceptance and validation

**Status: OPEN.** The decisions are accepted; validation is not performed.

**Decision recorded 2026-09-17.** Vladimir, the owner, submitted the design-system workbook
payload selecting all 65 decisions (0 unresolved, 0 deferred). It is kept verbatim in
[docs/design-system/decision-payload.txt](design-system/decision-payload.txt) and recorded by
[DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) (status `Accepted`, version 1.0.0) and
[ADR-0008](adr/0008-quiet-performance-design-system.md). Substantive UI may now be built on it.

**Not an external-service gate** — it needs no credentials. It stays listed because what
remains can only be done by a person or on a device, and an agent must not assert it.

**Still required before this gate closes:** every row of the canonical list in
[DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md), Validation status. In summary:

1. The target user has used the critical journeys (R-022). The journeys are not built yet.
2. The manual accessibility matrix and a colour-blind simulation review are recorded (R-007).
   Browser-level evidence exists (accessibility-tree snapshots, keyboard walks, simulated
   colour-vision renders); runs by people with real assistive technology do not.
3. The proposal review UX is decided in its own change, with visual baselines.
   Evidence: 2026-09-17, Vladimir directed and Claude implemented, the minimum review screens the agent-proposals
   specification requires are Storybook reference screens with darwin baselines and behaviour
   tests; Linux baselines are tracked by item 4.
4. Linux visual baselines exist and CI runs the visual gate in the pinned Playwright
   container. Linux baselines are committed and `CI=1 pnpm verify` passes in that image locally;
   the workflow runs in it by digest. A GitHub Actions run has not happened (no remote, G-1).
5. The owner approves the baselines in a visual-change PR.
   Evidence: 2026-09-18, Vladimir, having visually reviewed the baseline artifact, approved the
   56 product-route baselines committed through `edf4c1b`
   (`edf4c1b756769ceb0e0190e2a61df851904b9592`): today, workout, summary and
   diagnostics, across the seven visual projects, on darwin and Linux. Bound to that exact set
   and that candidate; it does not extend to a later change to any of them.
   Still open: the other 564 tracked baselines are not covered by it, and no visual-change PR
   exists to approve anything in (no remote, G-1).
6. Storybook (`governance.lab.storybook`) is reviewed as a dependency change under
   LIC-2026-09-16 and its build permission is decided in a guardrail change, or the owner
   changes that decision.
   Evidence: 2026-09-17, Vladimir, approved the reviewed Storybook dependency change and the
   separate esbuild build-permission guardrail change; it is installed and gated by
   `pnpm storybook:build`, `test:e2e`, and `test:a11y`.
7. Installation, vibration, and the rest tone are confirmed on real iOS and Android phones.
8. Interaction to Next Paint is measured under 200 ms on a real phone (a lab measurement
   already passes in `test:e2e`), and the 16 px icon is reviewed.

**Done when** each numbered item has a line directly under it in the form
`Evidence: YYYY-MM-DD, <who>, <what was recorded and where>`. `pnpm test` refuses a closed status
without one per item, and without Linux and proposal review baselines.

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

**New review required before release (recorded 2026-09-17).** Vladimir's decision to use a
public GitHub repository with the intent to open-source the project (ADR-0009, D2) is a
distribution plan under condition 5. The repository cannot be made public, and nothing can be
released, until the licence exceptions are reviewed for that plan and a project licence is
chosen. The separately approved Storybook dependency change (2026-09-17) is recorded under
G-10.

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
