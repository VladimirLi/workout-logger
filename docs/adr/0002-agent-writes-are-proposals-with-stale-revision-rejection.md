# 0002 — Agent writes are proposals with stale-revision rejection

**Status:** Accepted
**Date:** 2026-09-16
**Discovery:** D-016, D-017, D-018, D-020, R-020, R-021

## Context

The point of the product is that an AI agent adapts the training plan. The risk of the
product is that an AI agent adapts the training plan. An agent that can write directly to
authoritative data can also, on a bad day, erase a month of training history — and the
user would not find out until the next time they looked.

Agents also operate on stale reads. An agent fetches the plan, reasons for a while,
possibly across a suspended session, and then writes. Between the read and the write the
user may have completed a session, edited the plan, or accepted a different proposal.

## Decision

External agents hold **no** write authority over authoritative product data.

1. Reads are immediate for an authenticated MCP client.
2. Every MCP write operation creates a **proposal**. It never mutates authoritative data.
3. A proposal record contains: proposal ID, authenticated actor/client, the **base
   revision** it was computed against, a canonical structured diff, the agent's rationale,
   creation and expiry timestamps, and an input hash.
4. The user approves or rejects the proposal. Only approval makes it authoritative.
5. If the authoritative base revision has changed when the proposal is approved, the
   proposal is **rejected as stale** and must be regenerated. The system does not rebase
   it, does not merge it, and does not ask the user to adjudicate a three-way diff.

The MCP surface exposes proposal tools for plan replacement, scheduled-session change,
exercise-prescription change, and completed-session correction. It exposes no generic
query tool, no arbitrary patch operation, and no direct delete.

## Consequences

**Good.** There is no code path by which an agent silently changes history. The stale rule
is a single comparison against one value, which makes it cheap to implement, cheap to
test, and impossible to get subtly wrong the way a merge algorithm can be. Every accepted
change carries its rationale and its provenance.

**Bad.** Agents will sometimes do work that is thrown away. A busy user who logs a session
between an agent's read and write invalidates the proposal. The agent must re-read and
re-propose.

**Accepted cost.** We prefer wasted agent work over a wrong merge. If stale rejection
becomes frequent enough to be annoying, the fix is narrower proposal scope or shorter
proposal lifetimes. Silent rebasing is explicitly off the table and a change proposing it
must supersede this ADR.

**The check and the write cannot be separated.** The staleness comparison is cheap, but a
comparison is only as good as the window between it and the write. Reading the revision,
evaluating the rule, and saving as three steps leaves a window in which another actor commits
and two proposals are accepted onto the same base - the exact outcome this ADR exists to
prevent. The decision therefore commits through a single **compare-and-set** on one
application port: the expected revision and the expected proposal status are evaluated and
the write applied atomically.

That is why the plan revision and the proposal record live behind **one** port rather than
two. Two ports made atomicity inexpressible.

An adapter satisfies this only with a genuine single statement or transaction. An
implementation that reads and then writes will pass the round-trip cases in the contract
suite and fail its compare-and-set cases, which is what those cases are for.

**Testing.** Stale-revision rejection is characterized by unit tests in `packages/domain`,
and its atomicity by deterministic concurrency tests in `packages/test-support` that simulate
another actor committing inside the window. It is the single behavior most worth
over-testing.
