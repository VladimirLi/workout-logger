# 0012 — One trusted write boundary, and one matrix of invariants

**Status:** Accepted
**Date:** 2026-09-19
**Discovery:** D-012, D-018, R-005, R-013, R-016
**Relates to:** [0002](0002-agent-writes-are-proposals-with-stale-revision-rejection.md), [0004](0004-typed-measurement-profiles.md), [0005](0005-supabase-behind-adapters.md), [0011](0011-supabase-development-project.md)

## Context

Two review cycles found the same shape of defect in different places: something the server was
supposed to know it instead took from the caller. First the expected revision, the target status,
the decision time and the payload fingerprint were parameters. Then the table privileges turned
out to leave every signed-in user able to write the rows those functions were guarding. Each was
fixed where it was found. That is how a boundary ends up with a different answer in each corner:
a rejection that needs a plan it should never read, a validator that accepts `"8"` for a
repetition count and a cardio result with no duration, a privilege set that still carries
`TRIGGER` because `REVOKE` named privileges one at a time.

The problem was never the individual holes. It was that nowhere said, in one place, **which
component is authoritative for each invariant, and what it derives that invariant from.** Three
components each enforce something:

- `packages/domain` — the invariants as the product understands them. Pure, total, and the
  reference for everything below it.
- `packages/application` + `packages/adapters-*` — the ports. These run on a device that a user
  controls, so nothing they assert is evidence.
- the database — the only component whose state a user cannot edit around.

A device is not a weaker copy of the server. It is untrusted input to it. Anything the server
needs to be true must be re-established from rows the server holds, no matter how correct the
client that sent it was.

## Decision

**The database is the only trusted writer.** A signed-in user holds `SELECT` on their own rows
and `EXECUTE` on three functions, and nothing else. Every write is a `SECURITY DEFINER` function
owned by `postgres` with `search_path` pinned, which takes the user from `auth.uid()` and derives
every fact it stores from rows it locks.

**A caller expresses intent and expectations, never facts.** An expectation is a compare-and-set:
the caller says what it believed when it decided, the server compares that with what it holds,
and a mismatch refuses the write and reports the server's value. This is not trust — a wrong
expectation can only lose. The port's compare-and-set contract is therefore carried end to end
rather than dropped at the adapter, *and* the server applies its own derivation on top of it:
both must hold.

**Every invariant has exactly one authoritative site.** The matrix below is that statement. A new
invariant is added to it or it is not enforced; a row without a test is not enforced either.

### The invariant matrix

`domain` is `packages/domain`; `db` is a `SECURITY DEFINER` function; `schema` is a constraint or
a privilege. "Derived from" is what the trusted site reads to establish the invariant — never the
payload.

| # | Invariant | Authoritative | Derived from | Proved by |
|---|---|---|---|---|
| I-1 | A write acts for the signed-in user only | db | `auth.uid()`, refusing NULL | `wrong-user.provider.ts`, `authenticated-rpc.provider.ts` |
| I-2 | A user may not write any table directly | schema | `REVOKE ALL PRIVILEGES`, then `GRANT SELECT` | `check-db-boundary.mjs`, `authenticated-rpc.provider.ts` |
| I-3 | A user reads only their own rows | schema | row-level security, forced, owner policy per table | `check-rls.mjs`, `wrong-user.provider.ts` |
| I-4 | Boundary functions cannot be shadowed | schema | owner `postgres`, `search_path` pinned, `EXECUTE` to `authenticated` only | `check-db-boundary.mjs` |
| I-5 | A decision applies to a proposal that is still pending | db | the proposal row under lock, plus the caller's expected status | `proposal-store.provider.ts`, `authenticated-rpc.provider.ts` |
| I-6 | An acceptance applies only to the plan it was computed against | db | the locked plan's revision vs. the proposal's stored `base_revision`, plus the caller's expected revision | `proposal-store.provider.ts` |
| I-7 | An acceptance advances the plan revision exactly once, in the same transaction | db | `UPDATE ... RETURNING` inside the function | `proposal-store.provider.ts` (race case) |
| I-8 | A rejection and a stale marking never read or advance the revision | db | proposal row only; no plan is read or locked | `proposal-store.provider.ts`, `authenticated-rpc.provider.ts` |
| I-9 | An expired proposal is not decidable | db | stored `expires_at` vs. `now()` | `authenticated-rpc.provider.ts` |
| I-10 | A decision's time is when the server took it | db | `now()` | `authenticated-rpc.provider.ts` |
| I-11 | Statuses and revisions are exactly the domain's vocabulary | domain, schema, db | `CHECK` constraints and a closed enum in the function; runtime validation of what comes back | `packages/domain`, `repositories.test.ts` |
| I-12 | A mutation is one of a closed set of kinds, fully formed | db | JSON type checks per field, not `->>` string coercion | `authenticated-rpc.provider.ts` |
| I-13 | A measurement is a valid profile of the current schema version | domain (`isMeasurement`), db (`is_valid_measurement`) | the payload's own types, checked exactly as the domain checks them | `packages/domain/src/session.test.ts`, `authenticated-rpc.provider.ts` |
| I-14 | A session's plan-derived facts are the plan's, not the caller's | db | the locked plan row's scheduled session: revision, exercise ids, combined-load permission | `authenticated-rpc.provider.ts` |
| I-15 | A set belongs to an exercise the session prescribes | db | the session's stored `exercise_ids` | `authenticated-rpc.provider.ts` |
| I-16 | Combined load is recorded only where the plan permitted it | domain, db | the session's stored `combined_load_exercises` | `authenticated-rpc.provider.ts` |
| I-17 | Nothing is recorded before its session started | domain, db | the session's stored `started_at` | `authenticated-rpc.provider.ts` |
| I-18 | A set's sequence is its order of recording | db | count of the session's stored sets | `authenticated-rpc.provider.ts` |
| I-19 | A completed session's facts are immutable; corrections are audited revisions | schema, db | `status = 'active'` required to write; corrections append-only | `authenticated-rpc.provider.ts` |
| I-20 | A session cannot complete before it started | domain, db | the session's stored `started_at` | `authenticated-rpc.provider.ts` |
| I-21 | A key and its mutation commit together, or neither | db | one transaction; the key is claimed before the mutation runs | `workout-transport.provider.ts` |
| I-22 | A replay returns the original result; a key reused for a different payload is refused | db | the stored payload compared with the delivered one | `workout-transport.provider.ts` |
| I-23 | A delay the server asked for is honoured | application | `Retry-After`, carried through the adapter | `workout-transport.test.ts`, `delivery.integration.test.ts` |

Two rows are deliberately **not** the database's: I-23, because backoff is a client policy, and
the domain half of I-13, because a device must refuse a malformed measurement before it is queued
rather than after a round trip. Both are duplicated on purpose; neither is relied on by the
server.

### What this forbids

- Adding a parameter that lets a caller state a fact the server can read. Expectations are
  allowed; facts are not.
- Granting a privilege on a table to `anon` or `authenticated` beyond `SELECT`. The migration gate
  replays every `GRANT` and `REVOKE` in order, starting from the ALL that Supabase's default
  privileges give, and fails unless the final state is exactly that.
- Enforcing an invariant in the adapter instead of the database. The adapter may validate what it
  receives back; it may not be the reason something holds.

## Consequences

The application's write path is narrow and slightly awkward: everything goes through three
functions, and adding a field means a migration. That is the point — the awkwardness is where the
authority lives.

`plpgsql` now holds real domain logic, duplicating rules `packages/domain` also states. The
duplication is a cost accepted deliberately: the domain's copy serves a device that is offline,
and the database's copy is the one that is authoritative. Where they could drift, the matrix names
both sites and both tests.

Reads stay direct PostgREST queries, so the client remains a thin reader over its own rows, and
row-level security is still what decides whose rows those are.

A live check (`scripts/check-db-boundary.mjs`) reads the deployed schema and asserts I-2 and I-4
as they actually exist on the project, because a migration that was written correctly and a
database that is configured correctly are different claims.
