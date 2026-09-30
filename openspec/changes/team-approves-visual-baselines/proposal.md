# Proposal

## Why

AGENTS.md required the owner to approve visual baselines ("What still requires a human" and
"Working on UI"). On 2026-09-30 the owner (Vladimir) instructed, on VLA-189: "I don't have to
approve visuals, lets remove that rule from the repository, I give my team the freedom to do
this type of approvals." This change records that instruction and moves baseline approval to
the team.

Serves: D-005 (agents own execution within the gates), D-034 (independent review), D-035
(guardrail separation stays intact).

## What Changes

- AGENTS.md: baseline approval leaves the human-only list; design-system foundations changes
  and G-10 validation stay human. A new baseline rule states that a baseline update is its own
  visual-change PR, shows before/after/diff images, is approved by the independent review agent,
  and has QA confirmation that the change is intended.
- DESIGN_SYSTEM.md (Visual regression) and docs/design-system/defaults.md (Governance,
  Visual baselines row): the rule statements now point to the AGENTS.md baseline rule.
- **Unchanged:** `pnpm test:visual` never writes a baseline; baselines are committed only in a
  dedicated visual-change PR; the 0.1 percent threshold; no retries; foundations changes need an
  ADR and an OpenSpec change; G-10 stays open and human-validated.

## Capabilities

### New Capabilities
- _(none: `skip_specs: true`; no runtime product behaviour changes)_

### Modified Capabilities
- _(none)_

## Impact

Changes what an agent may do (the team, not the owner, approves baseline updates), so it is
classified as needing an OpenSpec change under the AGENTS.md table.

**Not in this change (follow-ups):**

- `ENGINEERING.md` ("Baselines" bullet) restates the owner-approval rule. It is a guardrail
  path, so its edit is a separate guardrail-only PR (D-035).
- Historical evidence records stay as written: `docs/external-gates.md` G-10 item 5,
  DESIGN_SYSTEM.md change-control rows and provisional-baseline note, ADR-0008, and
  `decide-design-system` tasks 5.5 and its `engineering-gates` spec scenario. G-10 closure is a
  human decision; whether item 5 remains a closure criterion is for the owner to decide.
