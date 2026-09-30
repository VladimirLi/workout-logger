## 1. Record the accepted rule (this PR, docs only)

- [x] 1.1 Record the owner-accepted wording in `DESIGN_SYSTEM.md` (`layout.landscape.two-pane`),
      verbatim from VLA-144 (owner acceptance: VLA-130 confirmation e444e266)
- [x] 1.2 Update the implementation and proof columns of `docs/design-system/decision-matrix.md`
      for `layout.landscape.two-pane`; leave the workbook's "Accepted meaning" quote unchanged
- [x] 1.3 Reconcile task 3.6 of `decide-design-system`, which asserted the old rule
- [ ] 1.4 Owner approval on the PR (CODEOWNERS routes `/DESIGN_SYSTEM.md`); independent review
      verdict on the final SHA

## 2. Implementation and proof (separate PR: #34, VLA-130; not done here)

- [ ] 2.1 Landscape set screen keeps the log-set action in view and scrolls unilateral and
      combined-load controls inside the right pane, above the action
- [ ] 2.2 Add e2e coverage for a unilateral and a combined-load set at 667 x 375: the action
      stays in view and no control sits under it. The existing ordinary-set no-scroll test in
      `apps/web/e2e/design-system.spec.ts` stays as ordinary-case evidence
- [ ] 2.3 `pnpm verify` and CI green on the implementation PR
