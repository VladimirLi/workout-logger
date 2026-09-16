## Context

The foundation change produced boundaries, gates, and three finished capabilities. None of it
is reachable by a user: no persistence, no authentication, no offline queue, no serving MCP
endpoint, no product UI.

This change closes that gap. It is the change that makes D-004 true.

It is also the change with the most ways to quietly lose data. Everything below is shaped by
one asymmetry: a *delayed* sync is an inconvenience, a *lost* set is a lost fact, and a
*duplicated* set is a corrupted history that the user may never notice.

## Goals / Non-Goals

**Goals:**

- The user can follow the active plan and log a session, offline, on a phone, without losing
  a single recorded fact.
- An authorized external agent can read authoritative state and create proposals.
- The user can review and decide on proposals, with the staleness rule already built.
- The user can get all their data out.

**Non-Goals:**

- Multi-week periodization or encoded progression rules. Progression is an agent decision
  expressed as proposals.
- General concurrent offline editing with automatic conflict reconciliation. One device, one
  active session.
- Fine-grained MCP operation scopes. One revocable authorization with two scopes.
- Progress photos, body measurements, or any health-platform integration.
- Multi-user product features. Ownership and authorization stay multi-user-safe; the product
  does not.

## Decisions

### Idempotency keys are generated on the client, before the first attempt

Not server-assigned, not derived from content. A content hash collides when the user
legitimately logs two identical sets. A server-assigned key does not exist yet at the moment
the offline write happens, which is the only moment that matters.

The key is written atomically with the mutation and survives every retry. The server stores
it in the same transaction as the accepted mutation. That single property is what makes
duplicate-free replay a guarantee rather than a hope.

**Rejected:** deduplication by comparing recent rows. It cannot distinguish a retry from a
real second set of the same weight and reps.

### Ordering is per entity, and a stuck mutation blocks its own entity

Deliberate. Applying workout facts out of order is worse than delaying them. A permanently
failed mutation surfaces as `needs attention` and the user decides, rather than the system
skipping it to keep the queue moving.

**Rejected:** a global ordered queue (one stuck mutation freezes everything) and unordered
draining (results land in the wrong order).

### Background Sync is an optimization, never the mechanism

It is unavailable in Safari and Firefox, and the target device is a phone. Flush triggers are
foreground, connectivity restoration, authentication refresh, and explicit user action;
Background Sync is additive.

### Exactly three sync states

`saved on device`, `syncing`, `needs attention`. Three states can be designed, tested, and
explained exhaustively. Five cannot, and the extra two always turn out to be internal
distinctions the user does not act on differently.

Distinguishable without color, because the states also have to work for a colorblind user and
in bright gym lighting.

### Nothing automatically discards a queued mutation

Not on quota exhaustion, not on auth expiry, not on version upgrade. Quota exhaustion stops
*new* writes with a recovery action. Any destructive recovery path offers an export first.

This is the rule most likely to be eroded by a well-meaning cleanup routine, so it is stated
as a requirement with its own scenarios rather than left as an implementation habit.

### Deny-by-default is proven per operation, not per table

A table with row-level security enabled and one permissive policy is not secure; it is
configured. The tests assert denial for unauthenticated *and* wrong-user identities, for every
operation, and a missing denial test fails the gate.

### Proposals are refused at creation time if already stale

The staleness rule already rejects at decision time. Refusing at creation as well means the
user is not shown a proposal that was born stale. The decision-time check remains — it is the
one that closes the race.

### Corrections are revisions, and the original stays retrievable

D-015. A correction that overwrites is indistinguishable from a bug that overwrites. Both the
actor and the time are recorded, because "who changed this and when" is the first question
anyone asks about a surprising number.

### CSV names its units in the column headers

A spreadsheet has no type system. An exported `load` column without a unit is exactly the
ambiguity ADR-0004 exists to prevent, reintroduced at the last step.

## Risks / Trade-offs

**Three external gates block most of this.** G-2 (Supabase), G-3 (domain and relying-party
ID), G-4 (hosting). Sections 2 onward cannot start until G-2 closes. Section 1 (domain and
application) can.

**The relying-party ID is a one-way door.** Changing it invalidates every enrolled passkey.
Email OTP must be verified working as the recovery path *before* the first enrollment, so a
mistake is recoverable.

**UI tasks are blocked on the design system.** Marked individually in `tasks.md`. The
non-visual majority of this change is not blocked.

**Offline correctness is hard to test honestly.** Atomicity under process termination and
ordered draining under partial failure need deliberate fault injection, not happy-path tests.
If those tests are weak, this change ships a durability guarantee it has not earned.

**Supabase may no longer be the right answer.** D-025 requires a setup-time check that no
blocking requirement has emerged. That check has not been run.

## Open Questions

- Does the relying-party ID bind to `gym.vladimirli.com` or to the apex? Decide before any
  enrollment. (G-3)
- What is the proposal expiry lifetime? Too short wastes agent work; too long makes staleness
  the normal outcome. Needs a starting value and a review after real use.
- Does an idempotency record ever expire? If it does, replay after expiry can duplicate. If it
  does not, the table grows without bound.
- How does the offline queue behave when the authentication session expires mid-workout? The
  mutations must survive, but the flush cannot succeed until re-authentication.
