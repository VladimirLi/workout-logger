## ADDED Requirements

### Requirement: Visual regression is a required gate
`pnpm verify` SHALL run a visual-regression gate over committed baselines stored per platform.
The gate MUST NOT write or update a baseline, MUST NOT retry a failed screenshot, and MUST run
separately from the behavioural and accessibility browser gates.

#### Scenario: A baseline is missing
- **WHEN** `pnpm test:visual` runs and a page has no baseline for the current platform
- **THEN** the gate fails and no baseline file is created

#### Scenario: A screenshot matches only on retry
- **WHEN** a visual comparison fails and would pass on a second attempt
- **THEN** the gate fails, because visual projects allow no retries

#### Scenario: A pixel change exceeds the threshold
- **WHEN** a component change alters more than 0.1 percent of a page's pixels
- **THEN** `pnpm test:visual` fails and reports the differing pixel count

#### Scenario: Baselines are updated
- **WHEN** a contributor needs new baselines
- **THEN** they run `pnpm visual:update`, and the result is committed only in a visual-change
  pull request approved by the owner
