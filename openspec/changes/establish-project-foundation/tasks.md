## 1. Normative documents

- [x] 1.1 Write VISION.md from the accepted product decisions and verify it names the scope
      boundary and the first-slice success definition
- [x] 1.2 Write ROADMAP.md as outcomes with hypothesis, evidence, review date, and decision
      rule, and verify every deferred item records why
- [x] 1.3 Write SECURITY.md covering trust boundaries, MCP authorization, RLS, secrets, and
      supply chain
- [x] 1.4 Write OBSERVABILITY.md with the attribute allowlist, SLOs, and dual-path alerting
- [x] 1.5 Write ENGINEERING.md with the toolchain, canonical commands, and guardrail list
- [x] 1.6 Write DESIGN_SYSTEM.md marking every design area pending, and verify
      `pnpm test` asserts its status is still NOT DECIDED
- [x] 1.7 Write AGENTS.md defining agent roles, authority, and the OpenSpec classification
      policy
- [x] 1.8 Write ADRs 0001-0007 and verify the index lists each one
- [x] 1.9 Preserve docs/discovery/decision-record.md unchanged and verify `git diff` shows no
      modification to it
- [x] 1.10 Write docs/external-gates.md listing every gate that needs user or cloud
      authorization

## 2. Monorepo scaffold

- [x] 2.1 Pin Node and pnpm, add the version catalog, and verify `pnpm install` succeeds from
      the committed lockfile
- [x] 2.2 Create packages/domain with no workspace or framework dependency and verify
      `pnpm test:architecture` enforces it
- [x] 2.3 Create packages/contracts depending only on a schema library and verify the
      architecture gate enforces it
- [x] 2.4 Create packages/application declaring ports, and verify the gate rejects an adapter
      import
- [x] 2.5 Create packages/observability as the sole OpenTelemetry entry point and verify the
      gate enforces it
- [x] 2.6 Create packages/adapters-supabase as a skeleton that fails loudly naming gate G-2,
      and verify its tests assert that
- [x] 2.7 Create packages/test-support with synthetic builders and a port contract suite, and
      verify the suite runs against the in-memory reference
- [x] 2.8 Create apps/web as a neutral structural PWA shell with no UI framework, and verify
      `pnpm test` asserts no UI framework is declared
- [x] 2.11 Verify the manifest and service-worker PLUMBING only, and add a guard that fails
      if anything claims installability, or declares manifest icons, while
      DESIGN_SYSTEM.md is not accepted (installability itself is deferred to gate G-10)
- [x] 2.9 Create apps/mcp as a separate entry point that declares its tool surface and does
      not serve, and verify its tests assert the forbidden tools are absent
- [x] 2.10 Wire TypeScript project references and verify `pnpm typecheck` builds the whole
      graph

## 3. Gate suite

- [x] 3.1 Configure strict TypeScript and verify `pnpm typecheck` passes with
      noUncheckedIndexedAccess and exactOptionalPropertyTypes enabled
- [x] 3.2 Configure Biome and verify `pnpm lint` and `pnpm format:check` pass with zero
      warnings
- [x] 3.3 Configure Vitest projects with per-package coverage thresholds and verify
      `pnpm test` and `pnpm test:integration` pass
- [x] 3.4 Configure dependency-cruiser and verify it cruises more than 25 modules
- [x] 3.5 Prove the architecture gate rejects each layering violation and accepts a legal
      import, via scripts/architecture-gate.test.ts
- [x] 3.6 Implement the license gate and verify it fails on a prohibited license, an expired
      exception, and an exception missing its analysis
- [x] 3.7 Implement the vulnerability gate and verify it fails closed when the advisory
      registry is unreachable
- [x] 3.8 Configure secret scanning and verify it detects a credential in a tracked dotfile
      and in a dot-directory
- [x] 3.9 Implement migration validation and verify it is inapplicable with no migrations,
      fails on a non-concurrent index and a bare DROP COLUMN, and passes on a compliant
      migration
- [x] 3.10 Implement the guardrail co-change gate and verify it reports inapplicability with
      no merge base
- [x] 3.11 Add the browser smoke path and verify `pnpm test:e2e` passes against a production
      build
- [x] 3.12 Add the accessibility gate and verify it fails on a planted violation and on an
      undersized touch target
- [x] 3.13 Implement `pnpm verify` as the aggregate and verify it runs every gate and reports
      a summary

## 4. Delivery mechanics

- [x] 4.1 Configure conventional commits with commitlint and verify a malformed message is
      rejected
- [x] 4.2 Install the husky commit-msg and pre-commit hooks and verify they run
- [x] 4.3 Add the pull request template with mandatory intent, classification, and evidence
      fields
- [x] 4.4 Add CODEOWNERS and document the intended branch ruleset
- [x] 4.5 Add automated dependency updates grouped so a single upgrade does not open ten pull
      requests
- [x] 4.6 Add the changelog and release-versioning foundation
- [x] 4.7 Add SBOM generation that runs offline from the lockfile and verify its output parses
      as CycloneDX
- [x] 4.8 Write CI workflows that invoke the same root scripts, with third-party actions
      pinned to full commit SHAs
- [x] 4.9 Initialize OpenSpec and verify `pnpm spec:validate` passes

## 5. Foundation capabilities

- [x] 5.1 Implement the telemetry allowlist and verify the canary proves sentinel workout
      content never reaches the exporter
- [x] 5.2 Implement typed quantities with canonical units and verify bare numbers are not
      representable
- [x] 5.3 Implement discriminated measurement profiles with explicit unilateral side and load
      semantics, and verify the defaults and overrides
- [x] 5.4 Implement RIR-authoritative exertion with derived read-only RPE and separately
      tagged Borg, and verify the mapping including the floor at RPE 1
- [x] 5.5 Implement proposal stale-revision rejection and verify it never rebases, reports
      both revisions, and reaches a terminal status
- [x] 5.6 Implement the reviewProposal use case reading the authoritative revision at
      decision time, and verify the race is caught
- [x] 5.7 Implement per-invocation MCP authorization and verify expiry, audience, and
      separate scope enforcement

## 6. Evidence

- [x] 6.1 Run `pnpm verify` end to end and record the result
- [x] 6.2 Confirm the working tree contains no secret and no provisioned cloud resource
- [x] 6.3 Confirm the lockfile is committed
