# Design

## Context

See proposal.md. The owner-approval wording lives in AGENTS.md, DESIGN_SYSTEM.md,
docs/design-system/defaults.md, and (guardrail path) ENGINEERING.md.

## Decisions

- **Replace, do not delete.** Removing the owner requirement without a replacement would leave
  baseline approval unowned. The team rule keeps two independent attestations (review agent and
  QA agent) and the diff images, so a reviewer sees what pixels moved.
- **Dedicated PR kept.** The owner asked to drop approval, not the separation. The check that
  baselines change only in a visual-change PR is untouched.
- **Foundations and G-10 stay human.** The owner instruction covers approving visuals only.
