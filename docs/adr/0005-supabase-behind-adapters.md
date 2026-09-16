# 0005 — Supabase as the first-slice platform, behind adapters

**Status:** Accepted
**Date:** 2026-09-16
**Discovery:** D-025, D-026, R-011, R-013, R-015

## Context

The first slice needs managed Postgres, managed passwordless authentication, and row-level
authorization without building any of them. Supabase provides all three. It also provides
opinions — RLS policy shape, auth session handling, a client SDK, a migration workflow —
that are easy to spread through an application and expensive to extract later.

The product is exploratory (D-001) but the code is production-shaped (D-002). Betting the
domain on a vendor chosen in week one contradicts the second.

## Decision

Use **Supabase Pro** as the initial managed Postgres and authentication platform, subject
to a setup-time check that no blocking requirement has emerged. The free tier is
unsuitable for the production instance because projects pause.

**All Supabase-specific behavior lives in `packages/adapters-supabase`.** Queries, Auth,
RLS assumptions, storage, and deployment behavior are adapter concerns. The domain and
application layers own provider-neutral **ports** and know nothing about Supabase.

Adapter correctness is proved by **contract test suites** in `packages/test-support`. The
suites are written against the port, not against Supabase. A future adapter passes the
same suites.

The first slice will **not** maintain two working provider implementations. Portability is
a structural property here, not a running second implementation.

Application hosting is a separate decision from the persistence platform.

**Data protection while single-user (R-015):** no paid PITR and no scheduled backups. But
before **every** production migration: create an encrypted logical Postgres dump, store it
outside the application provider, verify it is readable, record its checksum against the
release, and **fail closed** if any step fails. Drill restoration into an isolated project
periodically.

## Consequences

**Good.** Fast start with managed auth and RLS. Replacing the platform is a bounded piece
of work — one package plus a passing contract suite — rather than an archaeology project.
Contract tests make "does the new adapter behave the same?" a runnable question.

**Bad.** The adapter boundary costs indirection, and some Supabase conveniences (realtime
subscriptions, generated types wired straight into components) cannot be used at their
most ergonomic.

**Accepted cost and explicit risk.** Complete loss of server-side data created *between*
migrations is explicitly accepted while Vladimir is the sole user. This is a deliberate
cost decision, not an oversight. It protects migration rollback only. Scheduled backups
and numeric RPO/RTO must be defined **before onboarding any external user**. If media
storage is ever introduced it needs a separate backup path, because database backups do
not include storage objects.

**Setup gate.** Provisioning the Supabase project requires the user's cloud authorization
and is not performed by an agent. See [docs/external-gates.md](../external-gates.md).
