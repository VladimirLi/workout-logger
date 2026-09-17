## Purpose

Establishes that the product's visual and interaction system is an explicit, accepted
decision, how it is encoded and enforced, and that UI implementation depends on it.

## ADDED Requirements

### Requirement: Substantive UI depends on an accepted design system
The repository SHALL record the design system's acceptance status in a single normative
document. A change implementing substantive UI MUST NOT be marked ready for implementation
while that status is not accepted, and once accepted it MUST build on the accepted tokens and
components.

Substantive UI means anything expressing a visual language: color, type scale, spacing
system, component styling, iconography, motion, chart styling, or product screens.
Structural and accessibility work — landmarks, focus order, route structure, minimum target
sizes — is not substantive UI.

#### Scenario: The status is still undecided
- **WHEN** the design system document's status is not accepted
- **AND** a change proposes to implement substantive UI
- **THEN** that change is not ready for implementation, and its proposal states the
  dependency explicitly

#### Scenario: Structural work proceeds while undecided
- **WHEN** a change adds a route, a landmark, or a focus-order fix and expresses no visual
  language
- **THEN** it may proceed while the design system is undecided

#### Scenario: A scaffold default is not a decision
- **WHEN** a tool or template introduces a UI framework, component library, or token
  vocabulary that was not explicitly decided
- **THEN** it is removed rather than adopted

### Requirement: No UI system is adopted implicitly
The web application SHALL declare no CSS framework, component library, or icon package that
the accepted design system does not name, and this MUST be machine-checked.

#### Scenario: A UI framework appears in the web application's manifest
- **WHEN** the web application declares a dependency on a CSS framework or component library
- **THEN** `pnpm test` fails and names the dependency

#### Scenario: An icon package is imported
- **WHEN** a web source file imports from an icon package
- **THEN** `pnpm test` fails

### Requirement: Acceptance is the owner's recorded decision, fully traced
Acceptance SHALL be recorded from the owner's own decision input, kept verbatim and pinned by
digest, and every selected option MUST be traced to the normative document and to a matrix row
naming where it is implemented and what verifies it. No option the owner did not select may
be named as selected.

#### Scenario: A selection is missing from the record
- **WHEN** the design system document is accepted and a selected option ID appears in neither
  the document nor the decision matrix
- **THEN** `pnpm test` fails and names the option

#### Scenario: The payload is edited after acceptance
- **WHEN** the committed payload's SHA-256 differs from the digest in the design system document
- **THEN** `pnpm test` fails

#### Scenario: An unselected alternative is recorded
- **WHEN** the decision matrix names an option ID that is not in the payload's selections
- **THEN** `pnpm test` fails and names it

### Requirement: The accepted system covers every design area
Acceptance SHALL record decisions for design tokens, color, typography, spacing, iconography,
motion, the component inventory and its API conventions, interaction states, charts and data
display, content voice, responsive behavior, and visual-regression baselines.

#### Scenario: An area remains undecided at acceptance
- **WHEN** acceptance is proposed while any listed area has no decision
- **THEN** acceptance is refused and the undecided area is named

### Requirement: Tokens are the single source of visual values
Visual values SHALL come from DTCG JSON token files in two tiers, core and semantic, from
which CSS custom properties and a typed table are generated. Only semantic tokens MUST be
exposed to components, and component stylesheets MUST NOT contain raw colors, durations,
easing curves, layer numbers, shadows, or pixel sizes outside media queries.

#### Scenario: The generated output drifts
- **WHEN** the committed CSS custom properties differ from what the token source generates
- **THEN** `pnpm test` fails

#### Scenario: A component uses a raw colour
- **WHEN** a component stylesheet contains a hex, rgb, or hsl color
- **THEN** `pnpm test` fails and names the file

#### Scenario: A reference does not resolve
- **WHEN** a semantic token references a core token that does not exist
- **THEN** generation fails and names the reference

### Requirement: Contrast meets the accepted target in both themes
Every semantic foreground and background pair SHALL meet 7:1 for ink on any surface and for
labels on the accent, 4.5:1 for other text, and 3:1 for borders and the focus ring, in both
light and dark themes.

#### Scenario: A token change lowers a pair below its minimum
- **WHEN** the on-accent color on the accent measures 6.9:1 in either theme
- **THEN** `pnpm test` fails and names the pair and theme

### Requirement: Components have closed APIs
Presentation primitives SHALL accept only closed variant and size props and MUST NOT accept a
`className` or `style` prop. Screens MUST import presentation only from the design system.

#### Scenario: A primitive gains a className prop
- **WHEN** a primitive's props type declares `className`
- **THEN** `pnpm test` fails

#### Scenario: A screen writes its own stylesheet
- **WHEN** a route file imports a CSS Module
- **THEN** `pnpm test` fails

### Requirement: The theme never flashes
The first visit SHALL render light regardless of the operating system preference. A stored
Light, Dark, or System choice MUST apply before first paint without depending on application
JavaScript, and the browser theme color MUST match the applied theme.

#### Scenario: A stored dark preference with scripts blocked
- **WHEN** the stored preference is dark and every application script fails to load
- **THEN** the page background is #101311 and the theme-color meta is #101311

#### Scenario: First visit with a dark operating system
- **WHEN** no preference is stored and the operating system prefers dark
- **THEN** the page background is #EDF0EC

### Requirement: Inherited constraints are inputs, not open choices
The design system SHALL satisfy the already-normative constraints: usability at a 375 by 667
CSS-pixel viewport without horizontal scrolling; one primary action to accept an unchanged
prescribed set; WCAG 2.2 Level AA with a 44 by 44 CSS-pixel minimum for primary in-workout
controls; three sync states distinguishable without relying on color alone; metric display
defaults; and RIR shown by default with derived RPE read-only.

#### Scenario: A candidate system fails a phone-width constraint
- **WHEN** a primary in-workout view requires horizontal scrolling at 375 CSS pixels
- **THEN** `pnpm test:visual` fails for that view

#### Scenario: Sync states rely on color alone
- **WHEN** two sync states share an icon shape or label text
- **THEN** `pnpm test:e2e` fails

#### Scenario: An in-workout control is undersized
- **WHEN** a load stepper button renders 46 CSS pixels tall
- **THEN** `pnpm test:a11y` fails and names the control

### Requirement: Identity is declared without claiming installability
Once accepted, the web application SHALL declare the accepted name, icons at 32, 180, 192, and
512 pixels plus maskable and monochrome variants, a standalone display, the launch background,
and no orientation lock. No shipped text MAY claim the application is installable until
installation has been verified on a real phone and recorded.

#### Scenario: A declared icon has the wrong size
- **WHEN** the manifest declares a 192x192 icon whose PNG is 180 pixels wide
- **THEN** `pnpm test:e2e` fails and names the icon

#### Scenario: An installability claim appears
- **WHEN** a shipped description says the app is installable
- **THEN** `pnpm test:e2e` fails

### Requirement: Visual regression coverage
Once accepted, the system SHALL have visual-regression baselines for every lab page and
reference screen — including the plan view, the active set, the rest state, the completion
summary, and every offline and synchronization failure state — at representative small and
large phone viewports and a wide viewport, light and dark themes, and 200 percent text.
Fixtures MUST pin time, data, fonts, browser, and animations. Before gate G-10 closes, the
proposal review view MUST also have baselines.

#### Scenario: A baseline is missing for a required state
- **WHEN** the baseline for the state matrix page is absent in any visual project
- **THEN** `pnpm test:visual` fails without writing a baseline

#### Scenario: A fixture leaves a source of variation unpinned
- **WHEN** two fresh renders of the same page produce different bytes
- **THEN** `pnpm test:visual` fails and names the page

#### Scenario: G-10 closes without proposal review baselines
- **WHEN** gate G-10 is marked closed and no proposal review baseline exists
- **THEN** the closure is refused

### Requirement: Automated checks do not establish conformance
Accessibility conformance SHALL require manual keyboard, screen-reader, zoom, orientation,
contrast, and touch-target verification in addition to automated scanning. An owner choice to
run only automated checks routinely MUST NOT be read as waiving this.

#### Scenario: Only automated scans were run
- **WHEN** conformance is claimed on the basis of automated scans alone
- **THEN** the claim is refused until the manual checks are recorded

### Requirement: A critical journey is validated by the target user
A critical journey SHALL NOT be marked validated on the basis of an agent critique or a lab
fixture. The target user MUST have used it.

#### Scenario: An agent approves a journey the user has not used
- **WHEN** an agent reports that a critical journey is well designed
- **AND** the target user has not used it
- **THEN** the journey remains unvalidated

### Requirement: Acceptance does not close validation
The design system gate SHALL remain open after acceptance until target-user journey use, the
manual accessibility checks, the proposal review UX with its baselines, baselines for the CI
platform, and owner approval of the baselines are recorded.

#### Scenario: The gate is marked closed without evidence
- **WHEN** gate G-10 is marked closed and does not mention R-022, manual checks, proposal
  review, and Linux baselines
- **THEN** `pnpm test` fails
