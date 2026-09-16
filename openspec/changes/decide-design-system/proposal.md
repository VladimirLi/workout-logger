## Why

Every web scaffold arrives with a visual opinion attached. Accepting it would establish this
product's visual language as a side effect of running a generator — a decision nobody made,
expensive to reverse once components are built on it, and producing a UI that looks like a
template rather than like this product.

This product is also unusually constrained visually. It is used one-handed, mid-set, on a
phone, sometimes offline, by someone out of breath. Those constraints deserve a deliberate
design pass.

`DESIGN_SYSTEM.md` currently reads `NOT DECIDED`. This change is the work that makes it read
`Accepted`. Until it does, no change implementing substantive UI may merge.

Serves: D-002, D-021, R-004, R-007, R-022. See `docs/adr/0007-design-system-deferred.md`.

## What Changes

- Decides tokens, color, typography, spacing, iconography, motion, the component inventory
  and its API conventions, interaction states, charts and data display, content voice, and
  responsive behavior.
- Produces visual-regression baselines and the fixture pinning they require.
- Replaces the provisional CSS baseline in `apps/web` with the decided system, or explicitly
  re-affirms plain CSS with custom properties as the decision.
- Rewrites `DESIGN_SYSTEM.md` to record the decision and flips its status to `Accepted`.
- Writes the accompanying ADR.
- Implements **no product feature**. This change decides how things look and behave; the
  features that use it are separate changes.

## Capabilities

### New Capabilities
- `design-system`: the accepted visual and interaction system, and the rule that UI changes
  depend on it.

### Modified Capabilities
- `engineering-gates`: adds visual-regression checks to the required gate suite once
  baselines exist.

## Impact

**Affected:** `apps/web` and the gate suite. No shared package below the presentation layer
changes.

**Blocks:** every change that implements substantive UI. That is the point of this change
existing separately rather than being folded into the first feature.

**Blocked on:** gate **G-10** in `docs/external-gates.md` — a human decision, not a
credential. An agent must not decide this alone.

**Explicitly not decided by this proposal.** This document describes the work; it does not
pre-empt its outcome. Naming a palette or a type scale here would be the exact failure it
exists to prevent.
