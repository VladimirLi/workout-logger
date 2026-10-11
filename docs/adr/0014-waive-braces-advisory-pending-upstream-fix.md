# 0014 — Waive braces advisory pending upstream fix

**Status:** Accepted  
**Date:** 2026-10-04  
**Approver:** Vladimir (written approval VLA-549, 2026-10-04 07:54 UTC)  
**Scope:** Narrow advisory exception only; does not weaken the gate or change severity thresholds

## Context

The advisory GHSA-vfj7-8cjw-p6xm (CVE-2026-93687) was published on 2026-09-18 and began failing `pnpm test:deps` in early October 2026 (`main` was last green on 2026-10-02). It identifies a stack-exhaustion DoS vulnerability in `braces@3.0.3`. The advisory reached this project's build-time tooling via the dependency chain:

```
. → @fission-ai/openspec@1.13.2 (devDependency)
  → fast-glob@3.3.3
    → micromatch@4.0.8
      → braces@3.0.3 [VULNERABLE]
```

This advisory immediately began failing `pnpm test:deps` (gate D-039, high/critical block) on every branch, blocking all pull requests.

### Investigation Findings

1. **No patched version exists on npm.** `braces@3.0.3` is the latest released version; no 3.0.4 or newer patch was available as of 2026-10-03.

2. **Upstream fix is approved but unmerged.** PR [micromatch/braces#72](https://github.com/micromatch/braces/pulls/72) contains a complete, minimal fix (adds `maxDepth` option) approved by maintainer brendanh-katalyst on 2026-09-25, but has remained unmerged for 2+ weeks. Multiple downstream projects (Tailwind, Next, ESLint) are similarly blocked.

3. **Scope is build-time only.** The vulnerable `braces` module is reached only via `@fission-ai/openspec`, which is a `devDependency`. No production import path exists; the vulnerability affects only OpenSpec CLI operations during development and CI (such as `spec:validate`). It does not reach users or deployed code.

4. **No viable workarounds exist within guardrails.** A git dependency override (point #2 above to the approved unmerged commit) violates pnpm's `blockExoticSubdeps` safety check. Disabling `blockExoticSubdeps` requires a guardrail change that cannot be bundled with product code (AGENTS.md rule 2).

## Decision

Waive GHSA-vfj7-8cjw-p6xm for `braces@3.0.3` reached via `@fission-ai/openspec` (devDependency only) pending the upstream fix release. This waiver is **narrow** and **conditional**:

- Applies **only** to GHSA-vfj7-8cjw-p6xm in the `braces` package.
- Applies **only** to `braces@3.0.3` reached through the single dependency path `.>@fission-ai/openspec>fast-glob>micromatch>braces`, and only while the finding is dev-only.
- Does **not** lower the severity threshold or weaken the gate (D-039 remains [HIGH] blocking).
- Does **not** approve any other advisory or any production-path vulnerability.

## Conditions

The waiver is valid **until an upstream release of `braces` with the approved fix is published to npm and can be installed without violating `blockExoticSubdeps`**. When that occurs, the Release & Supply-Chain Engineer will remove this waiver in a separate guardrail change.

**Review trigger:** 2027-01-04 (three months). If no upstream release has occurred by this date, the waiver requires explicit re-approval before continuing.

## Consequences

**Positive.** Unblocks all pull requests and enables CI to resume normal gate checking. Allows the project to continue while waiting for upstream maintenance.

**Risk mitigated.** The vulnerability is build-time only (devDependency, no production import). The impact is limited to preventing DoS during OpenSpec operations; it does not affect runtime code or user data. The risk is accepted as reasonable for a narrow, time-bound waiver in a single-user project with no public release deadline before the upstream fix.

**What does not change.** Gate D-039 remains strict: any **new** high/critical advisory, any advisory affecting a production-path dependency, or any reachability change still blocks. This waiver is a singular exception, not a precedent for relaxing the gate.

## Implementation

Waivers are recorded in `docs/advisory-waivers.json`, a guardrail file read by `scripts/audit-check.mjs`. The gate removes an advisory from its blocking list only when every finding matches the waiver's GHSA id, module, exact installed version, recorded dependency path and dev-only flag, and the `review_trigger` date has not passed. Any mismatch, a missing or past date, or a malformed record leaves the advisory blocking. After 2027-01-04 the gate blocks again until Vladimir re-approves. `scripts/audit-report.test.ts` covers each of these cases.
