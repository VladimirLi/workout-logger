# Roadmap

**Status:** Normative. Outcome-based, not feature-based.
**Source:** Promoted from [docs/discovery/decision-record.md](docs/discovery/decision-record.md) on 2026-09-16.

Each outcome names a hypothesis, the observable evidence that would confirm it, a review
date, and a decision rule (R-002). Usage evidence, incidents, and direct observation enter
a monthly review as *evidence*; they never silently modify normative requirements. Any
product-behavior change still goes through the OpenSpec classification policy in
[AGENTS.md](AGENTS.md).

Outcomes are ordered by dependency, not by date. An outcome is `validated` only after the
target user has actually used it (R-022) — an agent critique cannot validate a journey.

---

## O-0 — Foundation is trustworthy

**Status:** in progress (this milestone)

**Hypothesis.** A repository with machine-enforced boundaries and an authoritative gate
suite lets agents extend the product without a human reviewing every diff.

**Evidence.** A clean checkout runs `pnpm install && pnpm verify` successfully with no
undeclared global tools. Every gate in [ENGINEERING.md](ENGINEERING.md) either passes or
fails honestly for a real reason. Architecture direction and cycle checks reject a
deliberate violation.

**Review:** at first slice merge.
**Decision rule.** If a gate cannot run without external credentials, it ships as a pinned
CI configuration plus a deterministic local config validation, and the unverified boundary
is recorded in [docs/external-gates.md](docs/external-gates.md). It is never deleted to
make the suite green.

---

## O-1 — The user can follow a plan and log a session offline

**Status:** specified, not implemented

**Hypothesis.** A phone-first logging surface that survives suspension, refresh, and no
connectivity is enough to replace whatever Vladimir logs with today.

**Evidence.** Four real workouts over ≥ 2 weeks, one deliberately offline. Zero lost or
duplicated workout facts. Each session completed without developer intervention. Queued
mutations synchronize within 60 s of usable connectivity in ≥ 99.5 % of cases (R-019).

**Review:** two weeks after first production use.
**Decision rule.** If facts are lost or duplicated even once, stop feature work and fix
durability before anything else. If the loop works but is slow or awkward, that is an
interaction-design change, not a durability change.

---

## O-2 — An external agent can read state and propose a plan change

**Status:** specified, not implemented

**Hypothesis.** Read-plus-propose is sufficient authority for an agent to be genuinely
useful, and the stale-revision rule is sufficient protection against it being harmful.

**Evidence.** At least one real agent proposal created over remote MCP, reviewed by the
user, and accepted or rejected. At least one proposal correctly rejected as stale after
the base revision moved. No MCP write ever mutates authoritative data directly.

**Review:** four weeks after first production use.
**Decision rule.** If stale rejection is too frequent to be workable, the fix is better
proposal scoping or shorter proposal lifetimes — **not** silent rebasing (D-018).

---

## O-3 — Production is observable and recoverable

**Status:** specified, not implemented

**Hypothesis.** Metadata-only telemetry plus synthetic critical-journey checks detect real
failures without ever exposing workout content.

**Evidence.** A canary test proves sentinel workout content never reaches exported
telemetry (R-018). Synthetic journeys pass on each deployment and at least every 15
minutes (R-019). A pre-migration encrypted dump is created, verified readable, and
checksummed against the release, and the migration fails closed if any step fails (R-015).
A restore drill into an isolated project succeeds at least once.

**Review:** before the first production migration.
**Decision rule.** No production migration runs until the dump-verify-checksum path has
been drilled end to end.

---

## O-4 — Delivery is autonomous and attested

**Status:** partially specified

**Hypothesis.** Deterministic gates plus one independent agent reviewer bound to an exact
SHA can safely replace human approval for normal implementation changes (D-034, R-025).

**Evidence.** Merges occur only with every required check green and a machine-readable
approval bound to the candidate SHA. Release artifacts carry provenance attestations that
are verified before deployment (R-026). No principal both implements a candidate and
attests its review.

**Review:** after ten autonomously merged changes.
**Decision rule.** Any escaped defect that a gate could have caught becomes a new gate
before feature work resumes.

---

## Deferred, with the reason

| Deferred | Reason | Revisit when |
|---|---|---|
| Multi-week periodization, encoded progression rules | Progression is an agent decision expressed as proposals | O-2 validated and proposals feel too coarse |
| Progress photos, body measurements | Adds media storage and a separate backup path | A later product horizon, explicitly |
| Apple Health / Health Connect | No evidence it is needed yet | User asks for it |
| Fine-grained MCP scopes | One revocable authorization with two scopes is sufficient for one client | A second agent client exists |
| Scheduled backups, numeric RPO/RTO, paid PITR | Accepted risk while single-user (R-015) | Before onboarding any external user |
| Concurrent offline editing with auto-reconciliation | One device, one active session | A second device is in real use |
| SLSA Build Level 3 | Level 2 is proportionate to current risk | Risk profile changes |
