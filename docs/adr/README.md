# Architecture Decision Records

An ADR is written when a decision is **consequential**: it is expensive to reverse, it
constrains code that agents will write without asking, or a future reader would otherwise
re-litigate it.

Routine choices do not get an ADR. They live in [ENGINEERING.md](../../ENGINEERING.md).

## Format

`NNNN-kebab-title.md`, with sections: Status, Context, Decision, Consequences, and the
originating discovery decision IDs.

Status is one of `Proposed`, `Accepted`, `Superseded by NNNN`, or `Deprecated`. An ADR is
never edited to change its decision — it is superseded by a new one.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-modular-monolith-with-provider-neutral-domain.md) | Modular monolith with a provider-neutral domain | Accepted |
| [0002](0002-agent-writes-are-proposals-with-stale-revision-rejection.md) | Agent writes are proposals with stale-revision rejection | Accepted |
| [0003](0003-offline-first-transactional-outbox.md) | Offline-first logging via a transactional outbox | Accepted |
| [0004](0004-typed-measurement-profiles.md) | Typed, discriminated measurement profiles | Accepted |
| [0005](0005-supabase-behind-adapters.md) | Supabase as the first-slice platform, behind adapters | Accepted |
| [0006](0006-ci-is-the-authoritative-gate.md) | CI is the authoritative gate | Accepted |
| [0007](0007-design-system-deferred.md) | The design system is a deliberate, separate decision | Accepted |
