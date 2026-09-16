## Purpose

Establishes that the product's visual and interaction system is an explicit, accepted
decision, and that UI implementation depends on it.

## ADDED Requirements

### Requirement: Substantive UI depends on an accepted design system
The repository SHALL record the design system's acceptance status in a single normative
document. A change implementing substantive UI MUST NOT be marked ready for implementation
while that status is not accepted.

Substantive UI means anything expressing a visual language: color, type scale, spacing
system, component styling, iconography, motion, chart styling, or polished product screens.
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
The repository SHALL declare no UI framework or component library until one is explicitly
decided, and this MUST be machine-checked.

#### Scenario: A UI framework appears in the web application's manifest
- **WHEN** the web application declares a dependency on a CSS framework or component library
- **THEN** the check fails and names the dependency

### Requirement: Provisional CSS tooling must be provider-neutral and labelled
Foundational CSS tooling that remains before the decision SHALL impose no visual language,
component set, or token vocabulary, and MUST be recorded as provisional.

#### Scenario: The provisional baseline encodes no visual language
- **WHEN** the shell's stylesheet is inspected
- **THEN** it contains no palette, no type scale, and no spacing scale, and it is labelled
  provisional

### Requirement: The accepted system must cover every deferred area
Acceptance SHALL require decisions for design tokens, color, typography, spacing,
iconography, motion, the component inventory and its API conventions, interaction states,
charts and data display, content voice, responsive behavior, and visual-regression baselines.

#### Scenario: An area remains undecided at acceptance
- **WHEN** acceptance is proposed while any listed area has no decision
- **THEN** acceptance is refused and the undecided area is named

### Requirement: Inherited constraints are inputs, not open choices
The design system SHALL satisfy the already-normative constraints: usability at a 375 by 667
CSS-pixel viewport without horizontal scrolling; one primary action to accept an unchanged
prescribed set; WCAG 2.2 Level AA with a 44 by 44 CSS-pixel minimum for primary in-workout
controls; three sync states distinguishable without relying on color alone; metric display
defaults; and RIR shown by default with derived RPE read-only.

#### Scenario: A candidate system fails a phone-width constraint
- **WHEN** a candidate system requires horizontal scrolling at 375 CSS pixels for a primary
  in-workout view
- **THEN** the candidate is rejected rather than the constraint relaxed

#### Scenario: Sync states rely on color alone
- **WHEN** a candidate distinguishes saved-on-device, syncing, and needs-attention only by
  hue
- **THEN** the candidate is rejected

### Requirement: Visual regression coverage on acceptance
Once accepted, the system SHALL have visual-regression baselines covering the plan view, the
active set, the rest state, the completion summary, proposal review, and every offline and
synchronization failure state, at representative small and large phone viewports, light and
dark themes, and 200 percent text. Fixtures MUST pin time, data, fonts, browser, and
animations.

#### Scenario: A baseline is missing for a required state
- **WHEN** acceptance is proposed with no baseline for an offline failure state
- **THEN** acceptance is refused

#### Scenario: A fixture leaves a source of variation unpinned
- **WHEN** a visual-regression fixture does not pin fonts
- **THEN** the baseline is rejected as non-deterministic

### Requirement: Automated checks do not establish conformance
Accessibility conformance SHALL require manual keyboard, screen-reader, zoom, orientation,
contrast, and touch-target verification in addition to automated scanning.

#### Scenario: Only automated scans were run
- **WHEN** conformance is claimed on the basis of automated scans alone
- **THEN** the claim is refused until the manual checks are recorded

### Requirement: A critical journey is validated by the target user
A critical journey SHALL NOT be marked validated on the basis of an agent critique. The
target user MUST have used it.

#### Scenario: An agent approves a journey the user has not used
- **WHEN** an agent reports that a critical journey is well designed
- **AND** the target user has not used it
- **THEN** the journey remains unvalidated
