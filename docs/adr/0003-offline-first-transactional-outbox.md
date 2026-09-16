# 0003 — Offline-first logging via a transactional outbox

**Status:** Accepted
**Date:** 2026-09-16
**Discovery:** D-022, R-008, R-009, R-010

## Context

Gyms have bad signal. The user logs a set mid-workout and moves on; the app cannot block
on the network and cannot ask the user to retry. A lost set is a lost fact. A duplicated
set is a corrupted history, which is worse, because the user may not notice.

Naive retry produces duplicates. Naive fire-and-forget produces losses. Background Sync
would solve delivery but is unavailable in Safari and Firefox — and the target device is a
phone.

## Decision

**Transactional outbox in IndexedDB.**

- Each offline mutation and its outbox item are written **atomically** in one IndexedDB
  transaction. There is no window in which the mutation exists without its outbox entry,
  or the reverse.
- Every logical operation gets a stable client-generated UUID **idempotency key**,
  preserved across retries. A key may never be reused for a different payload.
- The server stores the key and its original result **transactionally with** the accepted
  mutation. Replay returns the original result instead of applying the mutation twice.
- Mutations drain **in order per entity**.
- Retry uses capped exponential backoff with full jitter, and honors a longer `Retry-After`
  response. Network errors, 408, 429, and 5xx are retryable. Other 4xx responses become
  permanent failures that require user attention.
- Background Sync is an optimization, never the only flush mechanism. Also flush on
  foreground, connectivity restoration, authentication refresh, and explicit user action.

**Three stable user-visible states, and only three:** `saved on device`, `syncing`,
`needs attention`.

- A queued workout mutation is **never** discarded automatically.
- Quota exhaustion stops new writes with a clear recovery action rather than dropping data.
- The app requests persistent storage and surfaces the granted/denied state in
  diagnostics.
- Any destructive recovery action must first offer an export of unsynchronized records.

Agent reads and proposals wait until authoritative server data is synchronized. The first
slice does not support general concurrent offline editing with automatic reconciliation.

## Consequences

**Good.** Duplicate-free replay is guaranteed by the idempotency key rather than by
hoping retries do not happen. The user always knows whether their data is safe. The three
states are few enough to design and test exhaustively.

**Bad.** Every write path must thread an idempotency key from the client through to the
server transaction, including future ones. The server needs an idempotency-key table with
its own retention policy.

**Accepted cost.** Ordering per entity means a single stuck mutation blocks later
mutations for that entity. That is intentional: out-of-order application of workout facts
is worse than delay. A permanently failed mutation surfaces as `needs attention` and the
user decides.
