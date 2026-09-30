# Tasks

## 1. Rules and docs (this PR, no guardrail paths, no product code, no baselines)

- [x] 1.1 AGENTS.md: remove baseline approval from the human list; add the team baseline rule
- [x] 1.2 DESIGN_SYSTEM.md and docs/design-system/defaults.md: point the rule at AGENTS.md
- [ ] 1.3 Open the docs PR; `pnpm test:guardrails` and `pnpm spec:validate` pass

## 2. Guardrail wording (separate PR)

- [ ] 2.1 ENGINEERING.md "Baselines" bullet: replace "approved by the owner" with the team rule
- [ ] 2.2 Open guardrail-only PR; `pnpm test:guardrails` passes

## 3. Owner decision (open)

- [ ] 3.1 Owner decides whether G-10 item 5 (owner approves baselines) remains a closure criterion
