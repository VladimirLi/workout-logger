# 0001 — Modular monolith with a provider-neutral domain

**Status:** Accepted
**Date:** 2026-09-16
**Discovery:** D-026, D-027, D-028, D-029, D-030, D-031, R-027

## Context

The product has two deployable surfaces — a Next.js PWA and a remote MCP server — that
share the same workout domain, the same invariants, and the same persistence. Building
them as separate services would duplicate the domain and let the two surfaces drift.
Building them as one Next.js application would bind the MCP transport to the web
framework's request lifecycle and deployment target.

Supabase is the first-slice platform (see [0005](0005-supabase-behind-adapters.md)) but
was chosen for speed, not permanence. If Supabase-specific behavior leaks into the domain,
that speed becomes a one-way door.

## Decision

One pnpm monorepo. A modular monolith with shared domain and application packages, and two
independently deployable applications.

```text
apps/web                    Next.js PWA + server-route adapter
apps/mcp                    remote MCP transport adapter
packages/domain             entities, value objects, invariant rules
packages/application        use cases and provider-neutral ports
packages/contracts          versioned API/MCP schemas and generated types
packages/adapters-supabase  Supabase implementations of application ports
packages/observability      approved telemetry API and allowlist
packages/test-support       synthetic builders and adapter contract suites
```

Dependency direction is one-way and machine-enforced:

```text
apps  →  adapters  →  application  →  domain
                          ↘  contracts  ↙
```

- `packages/domain` depends on **no** framework, no I/O package, and no other workspace
  package. TypeScript and pure value libraries only.
- `packages/contracts` may depend only on a schema library (Zod).
- `packages/application` depends on `domain` and `contracts`. It declares **ports**; it
  never imports an adapter.
- Adapters depend on `application`, `contracts`, and `domain`. Nothing depends on an
  adapter except an app's composition root.
- `apps/*` are composition roots. They wire adapters into use cases.

Every package declares explicit Node `exports`. Cross-package deep imports are forbidden.
TypeScript project references plus dependency-cruiser enforce an acyclic graph and the
direction above.

No empty extension layers. A package exists because something imports it, not because a
diagram wanted symmetry.

## Consequences

**Good.** The domain is testable with no I/O, no mocks of a vendor SDK, and no framework
boot. Replacing Supabase means writing one new adapter package and passing the existing
contract test suite. The MCP server deploys and scales independently of the PWA.

**Bad.** More packages than a single app needs on day one, and a build graph that must be
kept acyclic. Contributors must learn where a change belongs before writing it.

**Accepted cost.** The dependency-direction check will reject convenient shortcuts — for
example importing the Supabase client inside a use case. That rejection is the point; it
is not a gate to relax.

**Enforcement.** `pnpm test:architecture` fails on any cycle or direction violation. The
rule set lives in `.dependency-cruiser.cjs` and is a guardrail file.
