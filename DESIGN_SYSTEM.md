# Design System

**Status: NOT DECIDED. Pending a dedicated, iterative design-system decision.**

This file is a **gate**, not a design. Nothing below has been chosen. It exists so that
the absence of a decision is explicit and machine-checkable rather than filled in by
whatever a scaffold happened to default to.

## The rule

> **No substantive UI implementation may merge until this document records an accepted
> design system and its status is `Accepted`.**

"Substantive UI" means anything that expresses a visual language: color, type scale,
spacing system, component styling, iconography, motion, chart styling, or polished product
screens.

`apps/web` in this milestone is an **intentionally neutral structural PWA shell**:
semantic HTML, document structure, routing, manifest, service-worker registration, and
accessibility scaffolding. It is deliberately unstyled beyond the minimum needed to be
legible and accessible. It is not a draft of the product's look, and it must not be
treated as one.

## What is explicitly pending

Each item is undecided. None has a provisional default that may be relied on.

| Area | Status |
|---|---|
| Design tokens (naming, structure, theming mechanism) | Pending |
| Color (palette, semantic roles, light/dark, contrast strategy) | Pending |
| Typography (families, scale, weights, line heights, licensing) | Pending |
| Spacing and layout grid | Pending |
| Iconography (set, style, licensing, delivery) | Pending |
| Motion (durations, easing, reduced-motion strategy) | Pending |
| Component inventory and component API conventions | Pending |
| Interaction states (default, hover, focus, active, disabled, loading, empty, offline, error) | Pending |
| Charts and data display | Pending |
| Accessibility beyond the baseline in [ENGINEERING.md](ENGINEERING.md) | Pending |
| Content voice and microcopy | Pending |
| Responsive behavior and breakpoints | Pending |
| Visual-regression baselines and fixtures | Pending |

## What is already normative and is *not* pending

These come from accepted discovery decisions and constrain whatever design system is
chosen. They are requirements the design system must satisfy, not design choices.

- **Phone-first.** On a 375 × 667 CSS-pixel viewport, the current exercise, current target
  versus actual result, sync state, and primary log action are usable without horizontal
  scrolling. (R-004)
- **One primary action** to accept an unchanged prescribed set. (R-004)
- **WCAG 2.2 Level AA** target. Primary in-workout controls additionally meet a
  **44 × 44 CSS-pixel** touch target, because gym use is one-handed and motion-prone.
  (R-007)
- **Three stable sync states** — `saved on device`, `syncing`, `needs attention` — must be
  distinguishable without relying on color alone. (R-010)
- **Metric display by default**: kg, km, min/km. (Resolved decision 3)
- **RIR shown by default**, derived RPE read-only. (Resolved decision 4)
- Automated accessibility scans alone cannot establish conformance. Manual keyboard,
  screen-reader, zoom, orientation, contrast, and touch-target checks are required. (R-007)
- Visual regression must eventually cover plan, active set, rest state, completion
  summary, proposal review, and every offline/sync failure state, at representative small
  and large phone viewports, light and dark themes, and 200 % text, with fixtures pinning
  time, data, fonts, browser, and animations. (R-007)

## Tooling constraint

No UI system — Tailwind, shadcn/ui, Material, Chakra, or any other — has been selected.
A scaffold defaulting to one is **not** a decision and must be removed.

Foundational CSS tooling may remain in the shell only if it is:

1. **provider-neutral** — it imposes no visual language, component set, or token
   vocabulary; and
2. **explicitly provisional** — recorded here as such, and re-decided as part of the
   design-system decision.

Currently permitted on that basis: plain CSS with native custom properties and standard
CSS nesting, scoped via CSS Modules. This is provisional. It encodes no palette, no type
scale, and no spacing system.

## How the decision will be made

The design system is decided iteratively as its own body of work, not as a side effect of
a feature change. It is expected to produce, at minimum: a token set, a type and spacing
scale, a color system with verified contrast, a component inventory with interaction
states, motion rules, and visual-regression baselines.

When accepted, this file's status changes to `Accepted`, it records the decision (or links
to the artifacts that do), and the corresponding ADR is written.

## Dependency for future specs

Every OpenSpec change that implements substantive UI **must** declare a dependency on the
accepted design system, and must not be marked ready for implementation while this
document's status is `NOT DECIDED`. See
[`openspec/changes/`](openspec/changes/) and [AGENTS.md](AGENTS.md) § Working on UI.

See [docs/adr/0007-design-system-deferred.md](docs/adr/0007-design-system-deferred.md).
