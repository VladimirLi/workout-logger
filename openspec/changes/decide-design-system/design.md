## Context

`apps/web` currently exists as a structural shell: semantic HTML, routing, a manifest, a
service-worker registration, landmarks, focus order, and a 44 px target floor. It has no
palette, no type scale, and no spacing scale, and it says so on the page itself.

That is a deliberate holding position, not an oversight. The question this change answers is
what replaces it, and the question it must not answer prematurely is *what the answer is*.

## Goals / Non-Goals

**Goals:**

- A decided, documented visual and interaction system covering every area currently pending.
- Visual-regression baselines with deterministic fixtures.
- An ADR recording what was chosen and what was rejected.

**Non-Goals:**

- Implementing any product feature. Features that consume the system are separate changes.
- Deciding the outcome inside this planning document.
- Relaxing any inherited constraint to accommodate an attractive candidate.

## Decisions

### The decision is made iteratively, as its own body of work

Not as a side effect of the first feature. A design system arrived at incrementally while
shipping features becomes whatever the first three screens needed, and the fourth screen
then fights it.

**Rejected:** folding the design decision into the first UI feature change. It produces a
system shaped by one screen and gives the reviewer two unrelated things to judge at once.

### The gate is a document status, not a convention

`DESIGN_SYSTEM.md` has a machine-checked status, and a test asserts it still reads
`NOT DECIDED`. That test is updated in the same change that records acceptance — deliberately,
so acceptance cannot happen quietly.

**Rejected:** a checklist in a contributing guide. Conventions decay; an assertion does not.

### Structural and accessibility work is explicitly carved out

Otherwise the gate blocks route structure, landmarks, and focus-order fixes that have nothing
to do with visual language, and contributors learn to route around it.

### Inherited constraints are inputs

Phone width, the single primary action, WCAG 2.2 AA plus 44 px, three non-color-coded sync
states, metric defaults, RIR-by-default: already normative. A candidate system that fails one
is rejected, rather than the constraint being relaxed to fit the candidate. Recording them as
requirements in the spec makes that non-negotiable rather than a matter of taste.

### Baselines come after the decision, not before

Capturing visual-regression baselines against the unstyled shell would produce artifacts
discarded on the first day of real design work, and would create a false sense that visual
regression is covered.

### No candidate is named here

Not Tailwind, not shadcn/ui, not Material, not plain CSS with custom properties. Naming a
front-runner in the planning document is how a default sneaks back in through the side door.
Plain CSS with custom properties remains in the shell as an explicitly provisional baseline
and re-enters the decision on equal footing with everything else.

## Risks / Trade-offs

**UI feature work is blocked until this lands.** Accepted. The alternative is building
components on an undecided foundation and unwinding them later.

**The shell looks unfinished in the meantime.** It is unfinished, and it says so. Making it
look finished before the decision exists is the failure this change prevents.

**A human must decide.** Gate G-10. An agent can prepare candidates, prototypes, and contrast
analysis, but cannot accept the system. Acceptance also requires the target user to have
actually used the critical journeys (R-022) — which cannot happen until the first slice runs,
so this change and `first-vertical-slice` will interleave rather than strictly sequence.

**Scope creep into feature work.** The spec draws the substantive-UI line explicitly so that
"while we're in here" additions are visible in review.

## Open Questions

- Does acceptance require the first vertical slice to be usable first, given R-022's
  requirement that the target user actually use critical journeys? Current reading: the two
  changes interleave, and journeys are marked validated only after real use.
- Does the product need charts at all in the first horizon, or is data display limited to
  tables and summaries? Affects how much of the charts area must be decided now.
