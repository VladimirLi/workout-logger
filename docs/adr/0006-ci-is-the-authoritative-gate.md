# 0006 — CI is the authoritative gate

**Status:** Accepted
**Date:** 2026-09-16
**Discovery:** D-005, D-032, D-033, D-034, D-035, D-036, D-037, R-023, R-025, R-026, R-028

## Context

Normal implementation changes do not require human approval (D-005). Something other than
a human must therefore be trustworthy enough to gate a merge. If that something is a local
hook, it can be skipped. If it is the implementing agent's own assertion, it is not
evidence. If it is a reviewer with a write credential, it is not independent.

There is also an obvious failure mode: an agent that cannot make a gate pass edits the
gate.

## Decision

**CI is authoritative.** Local hooks provide fast feedback and never replace a protected
CI check. Every applicable required gate must pass before merge.

**Local commands match CI exactly.** Root scripts are the only CI interface:
`install`, `dev`, `format`, `format:check`, `lint`, `typecheck`, `test`,
`test:integration`, `test:e2e`, `test:a11y`, `test:architecture`, `build`, `verify`.
`verify` runs every required non-deployment gate. CI invokes these scripts; it does not
inline its own commands. A clean, documented bootstrap must run `install && verify`
successfully with no undeclared global tools and no machine state.

**An implementing agent may not modify the required gates evaluating that implementation
in the same change** (D-035). Guardrail files are listed in [ENGINEERING.md](../../ENGINEERING.md)
and a CI job fails a PR that touches both guardrail files and product code. Legitimate
guardrail changes are submitted separately and reviewed by an independent agent under the
existing gates (D-036).

**Gates fail honestly.** A gate that cannot run is a failure, not a skip. A gate that is
not yet applicable — for example migration validation before any migration exists — must
detect that condition deterministically and pass with an explicit statement of why, and
must start failing the moment it becomes applicable. Placeholder gates that always pass
are forbidden.

**Independent review (R-025).** The reviewer uses a separate invocation and credential,
receives the accepted specification, the exact candidate SHA, the diff, the tests, and the
required evidence — but not the implementer's private reasoning. Any new commit
invalidates the verdict. A machine-readable approval bound to the exact SHA is a required
status check. No principal both implements a candidate and attests its review or CI
result. High and critical findings block; a waiver requires human approval and a durable
rationale.

## Consequences

**Good.** "Did this pass?" has one answer, produced by a principal with no stake in the
outcome. Because local commands are the CI commands, a green local run is meaningful
rather than aspirational.

**Bad.** CI is on the critical path for every change, so CI speed is a product concern.
Splitting a guardrail change from a product change costs an extra PR.

**Accepted cost.** Agents will occasionally be blocked by a gate they believe is wrong.
The remedy is a separate, reviewed guardrail PR — never a same-change edit, and never
weakening a threshold to go green.

**External dependency, honestly stated.** Branch protection, required-check enforcement,
signed commits, and linear history are **GitHub-side configuration** that cannot be
created from this repository without a remote and owner credentials. Until that ruleset is
applied, "CI is authoritative" is a documented intent, not an enforced fact. The exact
required configuration is recorded in [docs/external-gates.md](../external-gates.md).
