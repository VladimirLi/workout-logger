# Proposal

## Why

ADR-0009 records the intent to open-source in a public GitHub repository. That plan is
blocked on choosing a project licence and completing LIC-2026-09-16 condition 5 review.
On 2026-09-24 the owner (Vladimir) chose **MIT** as the project licence. The repository
is still private; this change records and applies that licence choice only.

Serves: ADR-0009 (D2), R-029 (licence policy remains enforced), G-11 follow-up (project
licence chosen; exception re-review for public distribution remains separate).

## What Changes

- Add a root `LICENSE` file with the MIT text, copyright holder Vladimir Li, year 2026.
- Set every workspace package `"license"` field from `UNLICENSED` to `MIT`.
- Update README and ADR-0009 / `docs/external-gates.md` to record that the project licence
  is MIT and that making the repository public still requires condition 5 exception
  re-review under LIC-2026-09-16.
- **Does not** flip GitHub visibility to public.
- **Does not** amend or re-issue LIC-2026-09-16 (exception ledger and conditions unchanged).
- **Does not** publish npm packages, binaries, or redistributable builds (condition 2).

## Capabilities

### New Capabilities
- _(none — `skip_specs: true`; no runtime product behaviour changes)_

### Modified Capabilities
- _(none)_

## Impact

**Affected packages:** all workspace manifests (`license` field only) plus root `LICENSE`,
README, ADR-0009, and G-11 notes in `docs/external-gates.md`. Dependency direction unchanged.

**D-035:** root `package.json` and `packages/observability/` are guardrail paths; other
workspace manifests and docs are not. Guardrail and product edits land in separate PRs.

**Blocked on:** nothing for applying MIT in a private repo. Making the repo public remains
blocked on owner re-review of the twelve LIC-2026-09-16 exceptions for that distribution
plan.
