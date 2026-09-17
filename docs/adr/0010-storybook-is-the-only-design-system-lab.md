# 0010 — Storybook is the only design-system lab

**Status:** Accepted
**Date:** 2026-09-17
**Amends:** [0008](0008-quiet-performance-design-system.md) (the `/lab` route it described)
**Discovery:** R-007, R-022

## Context

ADR-0008 delivered two labs: a `/lab` route inside the web app, which rendered the component
inventory, the state matrix, and the coded reference screens, and a Storybook, selected by
`governance.lab.storybook` and implemented once its dependency change was approved. Keeping
both meant two inventories to maintain, two places for a reference screen to drift, and product
routes that existed only to show fixtures.

On 2026-09-17 Vladimir reviewed the Storybook and decided: remove the separate `/lab` concept,
and make Storybook the sole component, pattern, state, and reference-screen lab. He also reported
poor categorization and accessibility problems in some pattern stories.

## Decision

1. **Storybook is the only lab.** The `/lab` routes are removed. Their content is stories:
   `Foundations/*`, `Primitives/*`, `Patterns/{Navigation, Workout, Feedback, Data, Settings,
   Proposals, Layout}/*`, and `Reference screens/*`, one component per story file.
2. **Reference screens are components, not routes.** They live in `apps/web/ui/reference/`,
   are built only from `apps/web/ui`, and use the fixtures there. The web app's routes are the
   product's routes only.
3. **The browser gates read the static Storybook build.** Visual regression, accessibility,
   behaviour, and responsiveness checks of components and reference screens load story iframes
   from the built Storybook, served locally during the gates.
4. **Stories are judged in page context.** A component story renders inside a main landmark
   with a page heading, and the theme is applied before the story renders, so every axe rule,
   including page-level ones, applies to every story in both themes.

`docs.source.repo-md-lab` named "/lab for live examples". This decision changes where the live
examples are, not the choice of a markdown-plus-lab documentation home.

## Consequences

**Good.** One inventory, pinned by tests: every exported component has a component-level story
in the agreed hierarchy. The audit that accompanied the move found and fixed two real defects:
the reduced-motion reset made every colour transition for a frame (dark-theme contrast failures
during a theme change), and the sticky action bar sat outside every landmark on two screens.

**Bad.** The browser gates now also depend on `pnpm storybook:build` having run, and the visual
suite is larger. Storybook's runtime is not the product's runtime, so product routes keep their
own accessibility and identity checks.
