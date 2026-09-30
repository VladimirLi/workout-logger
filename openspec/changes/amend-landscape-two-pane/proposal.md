## Why

`DESIGN_SYSTEM.md` (`layout.landscape.two-pane`) and the accepted decide-design-system tasks
say the landscape two-pane set screen needs **no scrolling at 667 x 375**. That cannot hold for
every set. At 375 px height, with 48 px workout targets and 8 px gaps, an ordinary set fits, but
a unilateral set (measured control pane about 354 px) and a combined-load set (about 484 px)
need more than the roughly 275 px available beside a log-set action that must stay in view.
Either the targets shrink below the accepted 48 px, or the rule changes.

The owner chose to keep the targets and change the rule. The UI/UX Designer proposed the
wording as decision VLA-144; the owner accepted it on 2026-09-29 (`request_confirmation`
e444e266-fc8e-4aca-8ba9-801d83fb03b4 on VLA-130, outcome `accepted`).

This is a change to user-visible behaviour (what scrolls and what stays in view in landscape),
so it is recorded here rather than treated as a wording fix.

Serves: ADR-0008 (design-system change control), VLA-130, VLA-144, VLA-189.

## What Changes

- Replaces "no scrolling at 667 x 375" for `layout.landscape.two-pane` with the accepted rule:
  an ordinary set fits with no scrolling; a unilateral or combined-load set scrolls its
  controls inside the right pane, above the action and never under it; the session summary,
  set table and Done sit below and scroll with the page.
- Updates `DESIGN_SYSTEM.md` with that wording, verbatim from VLA-144.
- Updates the implementation and proof columns of `docs/design-system/decision-matrix.md` for
  `layout.landscape.two-pane`. The "Accepted meaning" column keeps the workbook's original
  wording, because it quotes the owner's 2026-09-17 selection.
- Reconciles task 3.6 of `decide-design-system`, which asserted the old rule.
- Records, as open tasks, the implementation and tests that live in other PRs.

## Capabilities

### New Capabilities
- _(none)_

### Modified Capabilities
- `design-system`: adds a requirement for the landscape two-pane scrolling rule. The
  `decide-design-system` change that introduces the capability is not archived, so this is
  expressed as an added requirement rather than a modification of a published spec.

## Impact

**Affected:** `DESIGN_SYSTEM.md`, `docs/design-system/decision-matrix.md`,
`openspec/changes/decide-design-system/tasks.md`. No code, token, story, test or baseline is
touched here. The behaviour is implemented in PR #34 (VLA-130). Not a guardrail path change.

**Owner gate:** This is a layout-behaviour rule, not a foundation in the `DESIGN_SYSTEM.md`
change-control table (token tier, palette, type, spacing, motion), so it needs an OpenSpec change
but no ADR. It alters product behaviour and edits `DESIGN_SYSTEM.md`, so it needs owner approval
on the PR (CODEOWNERS routes `/DESIGN_SYSTEM.md`). If the owner classifies it as a foundation,
an owner-approved ADR is added instead.

**Follow-up:** the `apps/web/e2e/design-system.spec.ts` test "at 667 x 375 the set screen needs
no vertical scrolling" checks an ordinary set only. It stays valid as ordinary-case evidence
but cannot prove the rule for every profile. Coverage for unilateral and combined-load sets is
tracked in tasks 2.x and belongs to the implementation PR.
