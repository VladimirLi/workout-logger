## 1. Inputs

- [ ] 1.1 Extract the inherited non-negotiable constraints from R-004, R-007, and R-010 into a
      single checklist, and verify each maps to a requirement in this change's spec
- [ ] 1.2 Record the real use context in writing - one-handed, mid-set, phone, sometimes
      offline, out of breath - and verify each candidate is judged against it
- [ ] 1.3 Inventory the screens and states the first horizon actually needs, and verify the
      list covers plan, active set, rest, completion summary, proposal review, and every
      offline and sync failure state

## 2. Candidates

- [ ] 2.1 Prepare at least two distinct directions as working prototypes at 375x667, and
      verify each renders the full state inventory
- [ ] 2.2 Verify each candidate against the constraint checklist and record which constraint
      eliminated any rejected candidate
- [ ] 2.3 Verify each surviving candidate's contrast in light and dark at 200 percent text
      with an automated contrast check

## 3. Decisions

- [ ] 3.1 Decide the token structure and theming mechanism, and verify tokens resolve in both
      themes
- [ ] 3.2 Decide the color system with semantic roles, and verify every role pair meets WCAG
      2.2 AA contrast
- [ ] 3.3 Decide typography including families, scale, weights, line heights, and licensing,
      and verify the licence is compatible with docs/license-policy.md
- [ ] 3.4 Decide the spacing and layout scale, and verify no primary view scrolls horizontally
      at 375 CSS pixels
- [ ] 3.5 Decide iconography including set, style, licensing, and delivery, and verify the
      licence passes the license gate
- [ ] 3.6 Decide motion durations and easing, and verify every animation is suppressed under
      prefers-reduced-motion
- [ ] 3.7 Decide the component inventory and its API conventions, and verify every state in
      the inventory has a component that renders it
- [ ] 3.8 Decide interaction states for default, hover, focus, active, disabled, loading,
      empty, offline, and error, and verify focus is visible on every interactive component
- [ ] 3.9 Decide how the three sync states are distinguished, and verify they remain
      distinguishable in a grayscale rendering
- [ ] 3.10 Decide charts and data display, or record that the first horizon needs none, and
      verify the decision either way
- [ ] 3.11 Decide content voice and microcopy rules, and verify the shell's existing copy
      conforms
- [ ] 3.12 Decide responsive behavior and breakpoints, and verify rendering at both a small
      and a large phone viewport

## 4. Implementation

- [ ] 4.1 Replace or explicitly re-affirm the provisional CSS baseline, and verify
      `pnpm lint` and `pnpm test:a11y` still pass
- [ ] 4.2 Verify the web application declares only the UI dependencies this change decided,
      and that the no-implicit-UI-framework check reflects the decision
- [ ] 4.3 Verify `pnpm test:licenses` passes with any newly added font or icon dependency

## 5. Visual regression

- [ ] 5.1 Add visual-regression fixtures pinning time, data, fonts, browser, and animations,
      and verify two consecutive runs produce identical output
- [ ] 5.2 Capture baselines for every state in the inventory at both phone viewports, both
      themes, and 200 percent text, and verify none is missing
- [ ] 5.3 Add the visual-regression check to `pnpm verify` and verify it fails on a
      deliberate one-pixel change
- [ ] 5.4 Add manifest icons at the required sizes and verify the application is actually
      installable on a phone, flipping the installability guard from forbidding icons to
      requiring them

## 6. Acceptance

- [ ] 6.1 Rewrite DESIGN_SYSTEM.md to record the decision and verify no area remains marked
      pending
- [ ] 6.2 Flip the status to Accepted and update the status assertion in the same change, and
      verify `pnpm test` passes
- [ ] 6.3 Write the ADR recording what was chosen and what was rejected, and verify the ADR
      index lists it
- [ ] 6.4 Confirm the target user has used the critical journeys, per R-022, and verify the
      evidence is recorded rather than asserted
- [ ] 6.5 Close gate G-10 in docs/external-gates.md and verify it records who accepted the
      system and when
