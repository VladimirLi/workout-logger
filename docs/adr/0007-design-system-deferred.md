# 0007 — The design system is a deliberate, separate decision

**Status:** Superseded by [0008](0008-quiet-performance-design-system.md)
**Date:** 2026-09-16
**Discovery:** D-002, D-021, R-004, R-007, R-022

## Context

The foundation milestone scaffolds `apps/web`. Every modern web scaffold arrives with a
visual opinion attached — a CSS framework, a component library, a default type scale, a
palette. Accepting those defaults would silently establish the product's visual language
as a side effect of running a generator.

That is the wrong way to acquire a design system for three reasons. It is a decision
nobody made. It is expensive to reverse once components are built on it. And it produces a
UI that looks like a template rather than like this product.

The product is also unusually constrained visually: it is used one-handed, mid-set, on a
phone, sometimes offline, by a user who is out of breath. Those constraints deserve a
deliberate design pass, not a framework default.

## Decision

The visual design system is decided **explicitly and iteratively, before substantive UI
implementation**, as its own body of work.

1. [DESIGN_SYSTEM.md](../../DESIGN_SYSTEM.md) records the decision and currently has
   status `NOT DECIDED`. Tokens, typography, color, spacing, iconography, motion,
   components, interaction states, charts and data display, accessibility specifics,
   content voice, responsive behavior, and visual-regression baselines are all listed as
   pending.
2. `apps/web` in this milestone is an **intentionally neutral structural PWA shell**:
   semantic HTML, routing, manifest, service-worker registration, accessibility
   scaffolding. No brand, no visual language, no component library, no polished screens.
3. **No UI system is selected.** Not Tailwind, not shadcn/ui, not Material, not any other.
   A scaffold default is not a decision and is removed.
4. Foundational CSS tooling may remain only if provider-neutral (imposing no visual
   language, component set, or token vocabulary) and explicitly marked provisional.
   Currently: plain CSS with custom properties, scoped by CSS Modules.
5. Every future OpenSpec change implementing substantive UI declares a dependency on the
   accepted design system and cannot be marked ready for implementation while
   `DESIGN_SYSTEM.md` is `NOT DECIDED`.

Requirements that already constrain the design — phone-first at 375 × 667, one primary
action per set, WCAG 2.2 AA plus 44 × 44 px in-workout targets, three sync states not
distinguished by color alone, metric defaults, RIR by default — are **inputs** to that
decision, not part of it. They are already normative.

## Consequences

**Good.** The product's visual language will be chosen on purpose, against real use
constraints. No component work is built on a default that later has to be unwound. The
gate is explicit, so "we never decided this" cannot quietly become "we decided this by not
deciding."

**Bad.** UI feature work is blocked until the design system is accepted. The shell will
look plain and unfinished in the meantime, which is easy to mistake for lack of progress.

**Accepted cost.** The shell being visibly unstyled is intentional and is the honest state
of the project. Making it look finished before the design decision exists would be the
actual problem this ADR prevents.
