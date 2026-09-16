## Purpose

Defines the deterministic gate suite that permits agents to merge normal implementation
changes without human approval, and the rules that stop an agent from weakening it.

## ADDED Requirements

### Requirement: Canonical root commands are the only CI interface
The repository SHALL expose the required checks as root scripts, and CI MUST invoke those
scripts rather than inlining its own commands, so that a local run and a CI run execute the
same thing.

#### Scenario: A clean bootstrap verifies
- **WHEN** a clean checkout runs the install command followed by the verify command
- **THEN** both succeed with no undeclared global tools and no pre-existing machine state

#### Scenario: The aggregate gate covers every required non-deployment check
- **WHEN** the verify command runs
- **THEN** it executes formatting, linting, static types, unit and domain tests,
  integration tests, production build, architecture rules, license policy, dependency
  vulnerabilities, secret scanning, migration validation, guardrail co-change, spec
  validation, end-to-end tests, and accessibility checks

#### Scenario: Every gate runs even after one fails
- **WHEN** an early gate fails during the verify command
- **THEN** the remaining gates still run and the summary reports each one's result

### Requirement: Machine-enforced dependency direction
The system SHALL machine-enforce the dependency direction `apps -> adapters -> application
-> domain`, with contracts alongside, and MUST detect circular dependencies.

#### Scenario: The domain depending on an external library is rejected
- **WHEN** a module in the domain package imports an external library
- **THEN** the architecture gate fails

#### Scenario: Contracts depending on another workspace package is rejected
- **WHEN** a module in the contracts package imports another workspace package
- **THEN** the architecture gate fails

#### Scenario: The application layer importing an adapter is rejected
- **WHEN** a use case imports a provider adapter
- **THEN** the architecture gate fails

#### Scenario: One application importing the other is rejected
- **WHEN** a module in one app imports a module from the other app
- **THEN** the architecture gate fails

#### Scenario: A deep import past a package entry point is rejected
- **WHEN** a module imports a path inside another package rather than its declared entry
  point
- **THEN** the architecture gate fails

#### Scenario: A legal import is accepted
- **WHEN** a module imports another module inside its own package
- **THEN** the architecture gate passes

### Requirement: The architecture gate must be provably non-vacuous
The architecture gate SHALL be verified against deliberate violations, and MUST assert that
it observes a non-trivial module graph, so that a rule matching nothing cannot masquerade as
a rule being obeyed.

#### Scenario: The gate observes a real module graph
- **WHEN** the architecture gate runs
- **THEN** it reports having cruised more than 25 modules and more than 25 dependencies

### Requirement: Gates fail honestly
A gate that cannot run SHALL fail. A gate that is not yet applicable MUST detect that
condition deterministically, state why it is inapplicable, and begin failing as soon as it
becomes applicable. A gate that always passes regardless of input MUST NOT exist.

#### Scenario: The dependency audit cannot reach the advisory registry
- **WHEN** the vulnerability gate cannot reach the advisory source
- **THEN** it fails, rather than reporting success on data it never received

#### Scenario: Migration validation with no migrations present
- **WHEN** the migration gate runs and no migrations directory exists
- **THEN** it passes and states that no database is provisioned and which external gate
  covers it

#### Scenario: Migration validation once a migration exists
- **WHEN** a migration creates an index non-concurrently and omits lock and statement
  timeouts
- **THEN** the migration gate fails and names each violated rule

#### Scenario: A compliant migration passes
- **WHEN** a migration sets a lock timeout and a statement timeout and performs no blocking
  or destructive operation
- **THEN** the migration gate passes

### Requirement: Blocking vulnerability and license policy
The system SHALL block high and critical runtime vulnerabilities, and MUST block prohibited
or unresolved licenses in distributed runtime dependencies. Every license exception MUST
record component and version, SPDX expression, use and linkage, absence of an alternative,
obligations, an approver, and a review date no more than 12 months out.

#### Scenario: A prohibited license present in the tree fails the gate
- **WHEN** a dependency carries a license on the rejected list and has no valid exception
- **THEN** the license gate fails and names the component

#### Scenario: An exception with an expired review date fails the gate
- **WHEN** a license exception's review date has passed
- **THEN** the license gate fails

#### Scenario: An exception missing its analysis fails the gate
- **WHEN** a license exception omits its linkage analysis
- **THEN** the license gate fails, because a bare entry is a bypass rather than an exception

#### Scenario: An exception awaiting a named approver blocks
- **WHEN** an exception's approver is still pending
- **THEN** the license gate fails closed with a distinct owner-approval exit code and prints
  the decision ledger, rather than honouring the exception and reminding

### Requirement: Approved licence exceptions are pinned to what was approved
An approved licence exception SHALL cover only its exact component and version, in its
recorded scope, under its recorded licence expression. A named approver MUST count only when
a recorded owner decision by that approver lists the exact component, records its conditions,
and lasts at least as long as the entry. The ledger MUST describe the dependency tree exactly.

#### Scenario: A later version of an approved component
- **WHEN** an approved component is upgraded to a different version
- **THEN** the gate fails, because the approval does not extend to the new version

#### Scenario: A dev-approved component reaches the runtime tree
- **WHEN** a component approved in dev scope appears among runtime dependencies
- **THEN** the gate fails and reports the recorded and actual scope

#### Scenario: The installed licence expression changes
- **WHEN** an approved component's installed licence expression differs from the ledger
- **THEN** the gate fails

#### Scenario: An approved component is removed or no longer needs an exception
- **WHEN** a ledger entry's component is absent from the tree, or its licence is now allowed
- **THEN** the gate fails as a material dependency change requiring new review

#### Scenario: An approver name without a recorded decision
- **WHEN** an exception names an approver but no recorded decision by that approver lists
  the exact component
- **THEN** the gate fails rather than accepting the name

#### Scenario: The approval period ends
- **WHEN** the review date is a calendar date
- **THEN** the exception remains valid through the end of that date in UTC and fails from the
  next instant

### Requirement: SPDX WITH expressions are validated
A licence expression of the form `A WITH B` SHALL be classified by licence A only when B is a
recognised, current SPDX exception identifier and the pairing of A with B is a reviewed
combination. Unrecognised, deprecated, case-variant, or malformed exceptions, and invalid
pairings, MUST be treated as unknown. The recognised exception identifiers MUST come from an
authoritative source verified against the installed package.

#### Scenario: An unrecognised exception identifier
- **WHEN** a package is licensed `Apache-2.0 WITH Totally-Made-Up-exception`
- **THEN** its licence is unknown and the gate fails

#### Scenario: A real exception on the wrong licence
- **WHEN** a package is licensed `MIT WITH Classpath-exception-2.0`
- **THEN** its licence is unknown, because a permissive base licence must not launder an
  exception it does not accept

#### Scenario: A valid pairing
- **WHEN** a package is licensed `Apache-2.0 WITH LLVM-exception`
- **THEN** it is classified by `Apache-2.0`

#### Scenario: The pinned exception list drifts from its source
- **WHEN** the project's recognised exception list differs from the installed
  `spdx-exceptions` data
- **THEN** the verification fails

### Requirement: Licence approval conditions fail closed
While any licence exception relies on an approval, the gate SHALL fail if the repository shows
a distribution vector or a modification of an excepted dependency, because every exception's
analysis assumes the product is privately hosted and its dependencies are unmodified.

#### Scenario: A workspace package becomes publishable
- **WHEN** a workspace manifest is not marked private, or declares publish configuration
- **THEN** the gate fails and names the manifest

#### Scenario: A publish command or step is added
- **WHEN** a package script or workflow runs a package publish command or configures a
  publish step
- **THEN** the gate fails

#### Scenario: A binary or desktop build is introduced
- **WHEN** a manifest depends on a binary or desktop bundler, or a script builds a standalone
  executable
- **THEN** the gate fails

#### Scenario: An excepted dependency is patched or overridden
- **WHEN** a patch, override, resolution, or pnpmfile targets an excepted component
- **THEN** the gate fails

#### Scenario: Prose mentioning publishing
- **WHEN** a workflow comment states that it does not publish
- **THEN** the gate does not fail on that comment

### Requirement: Secret scanning covers dotfiles
Secret scanning SHALL cover dotfiles and dot-directories, because environment files are the
most likely location of a credential.

#### Scenario: A credential in a tracked dotfile is detected
- **WHEN** a tracked dotfile contains a recognizable credential
- **THEN** the secret gate fails and names the file

#### Scenario: A credential in a dot-directory is detected
- **WHEN** a file inside a dot-directory contains a recognizable credential
- **THEN** the secret gate fails

### Requirement: Accessibility gate
The system SHALL run automated WCAG 2.2 A and AA checks on every reachable route and MUST
enforce a 44 by 44 CSS-pixel minimum target for primary interactive controls. Automated
checks alone MUST NOT be treated as establishing conformance.

#### Scenario: An accessibility violation fails the gate
- **WHEN** a route contains an image without alternative text
- **THEN** the accessibility gate fails and identifies the route

#### Scenario: An undersized interactive target fails the gate
- **WHEN** a primary interactive control renders smaller than 44 by 44 CSS pixels
- **THEN** the accessibility gate fails

### Requirement: Guardrail self-modification is blocked
An implementing agent SHALL NOT modify the required gates that evaluate its implementation
within the same change. A change touching both guardrail paths and product code MUST fail.

#### Scenario: A change touches guardrails and product code together
- **WHEN** a change modifies a guardrail path and a product source file
- **THEN** the guardrail gate fails and lists both sets of files

#### Scenario: No merge base is available
- **WHEN** the guardrail gate runs with no comparable base revision
- **THEN** it states that it is inapplicable and names the external gate that activates it

#### Scenario: The guardrail list is documented and machine-readable
- **WHEN** the machine-readable guardrail list is compared with the engineering document
- **THEN** every guardrail path appears in both

### Requirement: Phone-first structural baseline
The web surface SHALL be usable at a 375 by 667 CSS-pixel viewport without horizontal
scrolling, and SHALL serve web app manifest and service-worker plumbing.

This requirement covers PLUMBING only. It does NOT claim the application is installable:
a browser will not offer to install a progressive web app without icons, and icons are
visual assets owned by the design system, which is not decided.

#### Scenario: No horizontal scrolling at phone width
- **WHEN** the shell is rendered at 375 by 667 CSS pixels
- **THEN** the document's scroll width does not exceed its client width

#### Scenario: The web app manifest route is served and well formed
- **WHEN** the manifest route is requested
- **THEN** it returns a manifest declaring standalone display and a root start URL

#### Scenario: The service worker registers
- **WHEN** the shell is loaded in a browser that supports service workers
- **THEN** a service worker registration exists

### Requirement: Installability is gated on the design system
The system SHALL NOT claim installability, and MUST NOT declare manifest icons, while the
design system is not accepted. Once the design system is accepted, the manifest MUST
declare icons. Both directions MUST be machine-checked.

#### Scenario: Icons added while the design system is undecided
- **WHEN** the manifest declares icons and the design system document is not accepted
- **THEN** the guard fails, because icons are visual assets and adding them decides part
  of the design system by accident

#### Scenario: Icons missing after the design system is accepted
- **WHEN** the design system document is accepted and the manifest declares no icons
- **THEN** the guard fails, so the check flips rather than quietly disappearing

#### Scenario: A shipped description claims installability
- **WHEN** a shipped manifest, package description, or service worker states that the
  application is installable while the design system is undecided
- **THEN** the guard fails
