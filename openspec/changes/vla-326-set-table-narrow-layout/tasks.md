## 1. Record the rule (this PR, docs only)

- [x] 1.1 Add the requirement in `specs/design-system/spec.md`
- [x] 1.2 Update `DESIGN_SYSTEM.md`: `data.set-table.aligned-table` and the SetTable row of the
      component table
- [x] 1.3 Update the implementation and proof columns of `docs/design-system/decision-matrix.md`
      for `data.set-table`; leave the workbook's "Accepted meaning" unchanged
- [ ] 1.4 Owner approval on the PR (CODEOWNERS routes `/DESIGN_SYSTEM.md`); independent review
      verdict on the final SHA

## 2. Implementation and proof (separate PR; builds on VLA-321 / PR #45, not done here)

- [ ] 2.1 `SetTable` stacks each row below 15 rem as specified, using a container query in rem
- [ ] 2.2 Table semantics survive the reflow (accessibility tree shows table, column headers, row
      headers); explicit ARIA roles only if a browser drops them
- [ ] 2.3 Measure the unstacked table with the longest realistic row; set the threshold above it
      and record the numbers in the PR
- [ ] 2.4 e2e at 320 x 640 with 200 % text (CDP `Page.setFontSizes`, standard 32 / fixed 26):
      Edit is fully inside the viewport and the region, no sideways scroll on region or page,
      keyboard focus ring not clipped; and at 375 x 667 with 100 % text the five columns remain
- [ ] 2.5 `SetTable` story covering a narrow container, and axe clean on it
- [ ] 2.6 `pnpm verify` and CI green on the implementation PR
