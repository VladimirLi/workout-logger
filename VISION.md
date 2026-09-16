# Vision

**Status:** Normative. Changes require human approval of product intent (see [AGENTS.md](AGENTS.md)).
**Source:** Promoted from [docs/discovery/decision-record.md](docs/discovery/decision-record.md) on 2026-09-16.

## Problem

Vladimir trains in a gym and wants to follow a plan and log what actually happened,
on a phone, with unreliable connectivity. Separately, he wants an AI agent to adapt
that plan based on his goals and his completed sessions — without that agent being
able to quietly rewrite his training history.

## Product

A single-user, installable, phone-first PWA for logging gym workouts, plus a remote
MCP server that lets an authorized external AI agent read workout data and **propose**
changes to the plan.

Two surfaces, one product:

- **PWA** — the human surface. Follow the active plan, log a session, review and
  approve or reject agent proposals. Works offline in the gym.
- **MCP server** — the agent surface. Immediate reads for an authenticated client;
  every write is a proposal, never a direct mutation.

## Principles

1. **Workout facts are sacred.** A synchronized completed-session fact is immutable.
   Corrections create audited revisions. No queued workout mutation is ever discarded
   automatically. (D-015, R-010)
2. **Agents propose, humans dispose.** External agents hold no write authority over
   authoritative data. Every proposal carries a base revision, a structured diff, and
   a rationale, and expires as stale rather than silently rebasing. (D-016, D-017, D-018)
3. **The gym is offline.** Core logging must work with no connectivity, durably queued
   on device, and synchronize without duplicating or losing anything. (D-022, R-008)
4. **Typed quantities, never bare numbers.** Every measurement carries a unit and a
   measurement profile. Display conversion never overwrites canonical storage. (R-005)
5. **The domain owes nothing to a vendor.** Domain and application layers are
   provider-neutral; Supabase, Next.js, and MCP live behind adapters. (D-026, D-028)
6. **Gates are the contract.** CI is authoritative. An implementing agent may not weaken
   the gates that judge it. (D-032, D-035)
7. **Telemetry carries no workout content.** Operational signals are structured
   metadata only, allowlisted, with a canary test proving it. (D-047, R-018)

## Scope of the first horizon

**In:** one active plan with scheduled sessions; strength, unilateral-strength, and
cardio measurement profiles; offline session logging with a transactional outbox;
passwordless web auth; OAuth-protected remote MCP with read + propose-only tools;
proposal review in the PWA; full JSON/CSV export.

**Out (explicitly deferred, not forgotten):** multi-week periodization and encoded
progression rules; progress photos and body measurements; Apple Health / Health Connect;
media storage; multi-user product features; plugins or user-defined measurement schemas;
fine-grained MCP operation scopes; general concurrent offline editing with automatic
conflict reconciliation.

Single-user is the **first-release** boundary, not a permanent product boundary.
Ownership, RLS, exports, and audit identity stay multi-user-safe from day one.

## Definition of success for the first slice

Not growth metrics — evidence that the loop works. Four real workouts across at least
two weeks, including one deliberately offline session and one agent proposal. The gate
passes only if no workout fact is lost or duplicated and Vladimir completes each journey
without developer intervention. (R-001)
