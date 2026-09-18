> Tasks are checked only where a gate proves them. Open items are open on purpose; see
> `DESIGN_SYSTEM.md`, Validation status, and gate G-10.

## 1. Decision input

- [x] 1.1 Commit the owner's workbook payload verbatim, and verify its digest, schema, and
      counts with `pnpm test` (scripts/policy-consistency.test.ts)
- [x] 1.2 Trace all 65 selected options in DESIGN_SYSTEM.md and the decision matrix, and verify
      with `pnpm test` that none is missing and no unselected option is named
- [x] 1.3 Record the defaults, deferrals, and reconciliation log, write ADR-0008 superseding
      ADR-0007, and verify the ADR index with `pnpm test`

## 2. Tokens

- [x] 2.1 Author DTCG 2025.10 core and semantic tokens with a generator, and verify drift,
      reference integrity, and step ordering with `pnpm test`
- [x] 2.2 Verify every role pair meets the AA+ target in light and dark with `pnpm test`
- [x] 2.3 Verify the first visit is light, a stored preference applies before any application
      script, and System follows the OS, with `pnpm test:e2e`

## 3. Components and rules

- [x] 3.1 Build closed-variant primitives and patterns, and verify tokens-only CSS, logical
      properties, the closed API, and screen imports with `pnpm test`
- [x] 3.2 Vendor the icons with their licence ledger, and verify the ledger with `pnpm test` and
      that no dependency changed with `pnpm test:licenses`
- [x] 3.3 Verify 44 px targets, 48 px workout targets and 8 px gaps, visible focus, reflow at
      200 percent text and 320 px, one h1, and axe in both themes with `pnpm test:a11y`
- [x] 3.4 Verify the stepper, RIR control, sheet, dialog, undo timing, timer announcements,
      log-to-rest, switches, reduced motion, forced colours, increased contrast, and distinct
      sync states with `pnpm test:e2e`
- [x] 3.5 Verify the CSS budget, that no font ships, the icon budget, and layout shift below
      0.05 with `pnpm test:e2e` and `pnpm test`
- [x] 3.6 Verify the centred column and the landscape two-pane with no scrolling at 667 x 375
      with `pnpm test:e2e`
- [x] 3.7 Provide the Storybook lab selected by governance.lab.storybook, and verify it builds
      in `pnpm verify` (`pnpm storybook:build`), every story renders (`pnpm test:e2e`), and every
      story passes axe in both themes (`pnpm test:a11y`)
- [x] 3.7a Make Storybook the only lab (owner decision 2026-09-17, ADR-0010): remove `/lab`,
      file one component-level story per exported component under Foundations, Primitives,
      Patterns by category, and Reference screens, and verify the inventory and hierarchy with
      `pnpm test` (stories.test.ts), every axe rule at 375 and 1280 px in both themes with
      `pnpm test:a11y`, and keyboard operation of interactive stories with `pnpm test:e2e`
- [x] 3.8 Measure interaction to next paint below 200 ms on the set screen, and verify it with a
      recorded measurement (`pnpm test:e2e`: Event Timing lab measurement at a 4x CPU slowdown
      over stepper, keyboard, RIR, sheet, and log-set interactions; worst 24 ms on 2026-09-17;
      field INP on a real phone remains unmeasured)

## 4. Identity

- [x] 4.1 Ship the accepted manifest, icons, and theme colour, flip the installability guard
      from forbidding them to requiring them, and verify with `pnpm test:e2e`
- [ ] 4.2 Verify the application is offered for installation on a real iOS and Android phone,
      and record the evidence (OPEN: device)

## 5. Visual regression

- [x] 5.1 Pin time, data, browser, animations, caret, time zone, and locale, store baselines
      per platform for the system font, and verify two fresh renders of every page are
      byte-identical with `pnpm test:visual`
- [x] 5.2 Capture baselines for the product routes and every Storybook reference screen (plan,
      active set, rest, summary, history, settings, empty, error, RIR help, proposal review,
      stale proposal, and the state matrix with every offline and sync failure state) in all
      seven projects, and for every foundation, primitive, and pattern story at the small phone
      in both themes, and verify none is missing with `pnpm test:visual`
- [x] 5.3 Add `test:visual` to `pnpm verify`, and verify with `pnpm verify` that it runs
- [x] 5.3a Verify, with a lasting test, that the visual gate fails on a change above the 0.1
      percent threshold and tolerates one below it, against the committed set-screen baseline
      (`pnpm test:visual`)
- [x] 5.4 Generate Linux baselines in the pinned Playwright container, run CI in that image,
      and verify the CI path passes: baselines generated only after every target rendered
      identically twice in every project, and `CI=1 pnpm verify` passing all gates inside
      `mcr.microsoft.com/playwright:v1.63.0-noble` (linux/amd64); `.github/workflows/verify.yml`
      runs in that image by digest (`pnpm test`: policy-consistency.test.ts)
- [ ] 5.4a Verify the GitHub Actions verify workflow passes on GitHub (OPEN: no remote or
      Actions run exists, gate G-1)
- [ ] 5.5 Have the owner approve the baselines in a visual-change PR, and record the approval
      (PARTLY DONE. 2026-09-18: Vladimir visually reviewed the baseline artifact and approved
      the 56 product-route baselines committed through `edf4c1b` — today, workout,
      summary and diagnostics, seven visual projects, darwin and Linux — bound to that exact
      set and candidate, and not extended to any later change to them. OPEN: the other 564
      tracked baselines, which are the design system's own, carry no such approval; and the
      approval was given by direct review because there is no remote to open a visual-change
      PR on, gate G-1)
- [x] 5.6 Capture proposal review baselines, and verify with `pnpm test:visual`: the minimum
      review screens the agent-proposals specification requires (base revision, diff,
      rationale, creation time, accept, reject, stale) are built from accepted components as
      `Reference screens/Proposal review` and `Reference screens/Stale proposal`, and behave as
      `pnpm test:e2e` checks. Any richer review UX is a first-slice decision.

## 6. Acceptance and validation

- [x] 6.1 Flip DESIGN_SYSTEM.md to Accepted with the status assertion changed in a separate
      guardrail commit, and verify `pnpm test` passes
- [ ] 6.2 Confirm the target user has used the critical journeys, per R-022, and verify the
      evidence is recorded rather than asserted (OPEN: journeys not built)
- [x] 6.3 Record browser-level evidence for the manual accessibility matrix and the colour-blind
      review, and verify it with `pnpm test` and `pnpm test:a11y`: token contrast as seen with
      deuteranopia, protanopia, and achromatopsia; visual baselines of the stateful screens
      under those emulations and forced colours; accessibility-tree snapshots of every reference
      screen; keyboard-only walks through logging, retry, undo, and proposal decisions
- [ ] 6.3a Run the manual matrix with people and real assistive technology (VoiceOver on iOS,
      TalkBack on Android, Windows forced colours, macOS Safari keyboard) and have a person
      review the colour-vision renders, and record the results (OPEN: human and device)
- [ ] 6.4 Close gate G-10 in docs/external-gates.md once every row of DESIGN_SYSTEM.md,
      Validation status, has evidence (tasks 3.7, 3.8, 4.2, 5.4, 5.5, 5.6, 6.2, 6.3 among them),
      and verify with `pnpm test` that each item carries a dated evidence line
