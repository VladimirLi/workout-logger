# Design

## Context

See proposal.md — Why. Today every workspace `"license"` is `UNLICENSED`, there is no
root `LICENSE`, and ADR-0009 / README state the licence is not chosen. LIC-2026-09-16
exception conditions still require private hosting and block release under a distribution
plan until a new exception review. Root `package.json` and `packages/observability/` are
guardrail paths (D-035); other workspace manifests are product paths.

## Goals / Non-Goals

**Goals:**

- Record MIT as the project licence in the places a reader and SPDX tooling look: root
  `LICENSE`, every package `"license"` field, README, ADR-0009, G-11 notes.
- Keep D-035: guardrail and product files in separate PRs / commits.
- Leave LIC-2026-09-16 decision text, conditions, and ledger untouched.

**Non-Goals:**

- Making the GitHub repository public.
- Re-approving or rewriting the twelve licence exceptions for a public distribution plan.
- Publishing packages to npm or enabling any publish path.
- Changing allowed/rejected dependency licence allowlists.

## Decisions

1. **Standard MIT text, copyright `Copyright (c) 2026 Vladimir Li`.** Matches the owner
   name used in licence decisions and ADR-0009. Rejected: SPDX-only without a LICENSE file
   (public OSS readers expect the full text at the root).

2. **Set `"license": "MIT"` on every workspace package, including private ones.** Packages
   stay `"private": true` (condition 2 / distribution detector). Rejected: leave
   `UNLICENSED` on private packages — that contradicts the chosen project licence.

3. **Split implementation across two PRs (D-035).** Product: `LICENSE`, non-observability
   package manifests, README, ADR-0009, `docs/external-gates.md`, OpenSpec change.
   Guardrail: root `package.json`, `packages/observability/package.json` only.

4. **Do not amend LIC-2026-09-16.** Condition 5 already says a distribution plan needs new
   review; choosing MIT does not itself re-approve exceptions for public hosting. Rejected:
   quietly rewriting condition 1 to allow public source — that needs an explicit owner
   decision with new decision id text.

## Risks / Trade-offs

- [Repo still private after MIT] → README and G-11 state public flip is still blocked on
  condition 5 exception re-review.
- [Someone assumes MIT implies exceptions re-approved] → Explicit non-goal and ADR/G-11
  wording; do not change `scripts/license-decisions.mjs`.
- [D-035 co-change] → Two PRs as above; `pnpm test:guardrails` on each.

## Migration Plan

1. Land product PR (LICENSE + product manifests + docs + OpenSpec).
2. Land guardrail PR (root + observability `license` fields).
3. Owner separately decides whether to re-review exceptions and flip visibility.

Rollback: revert the commits; no runtime data migration.
