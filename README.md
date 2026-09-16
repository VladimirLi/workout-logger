# Workout Logger

Single-user gym workout logger: an installable, phone-first PWA plus a remote MCP server that
lets an authorized AI agent read workout data and **propose** plan changes.

**Status: project foundation only.** No product feature is implemented. There is no
persistence, no authentication, no offline queue, no serving MCP endpoint, and no product UI.
See [ROADMAP.md](ROADMAP.md) for what is outcome-complete and what is not.

## Quick start

```bash
corepack enable        # provides the pinned pnpm
pnpm install
pnpm exec playwright install --with-deps chromium   # once
pnpm verify            # every required gate
pnpm dev               # http://localhost:3000
```

Node 22.23.1 (`.nvmrc`), pnpm 11.5.2. Engines allow `^22.22.1 || ^24 || >=26` — the
intersection of what the toolchain actually declares, which excludes the odd-numbered
non-LTS lines. `pnpm install && pnpm verify` must succeed on a clean
checkout with no undeclared global tools.

## What exists

| | |
|---|---|
| Normative intent | [VISION.md](VISION.md), [ROADMAP.md](ROADMAP.md), [docs/adr/](docs/adr/) |
| Working agreement | [AGENTS.md](AGENTS.md), [ENGINEERING.md](ENGINEERING.md) |
| Controls | [SECURITY.md](SECURITY.md), [OBSERVABILITY.md](OBSERVABILITY.md) |
| Blocking gate | [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) — the visual design system is **not decided** |
| Open gates | [docs/external-gates.md](docs/external-gates.md) — eleven, none provisioned |
| Specs | [openspec/](openspec/) — three changes, all validating |
| Discovery evidence | [docs/discovery/decision-record.md](docs/discovery/decision-record.md) |

Three capabilities are genuinely implemented and tested: the telemetry attribute allowlist
with its canary, agent-proposal stale-revision rejection, and typed measurement profiles.

## Layout

```text
apps/web                    Next.js PWA — structural shell, deliberately unstyled
apps/mcp                    remote MCP entry point — declares its tool surface, does not serve
packages/domain             entities, value objects, invariants — no framework, no IO
packages/application        use cases and provider-neutral ports
packages/contracts          versioned API/MCP schemas
packages/adapters-supabase  provider adapters — skeleton, no credentials
packages/observability      the only approved telemetry entry point
packages/test-support       synthetic builders and port contract suites
```

Dependency direction `apps -> adapters -> application -> domain` is machine-enforced by
`pnpm test:architecture`, and the gate's own effectiveness is asserted by a test that plants
deliberate violations.

## Commands

`pnpm verify` runs everything. Individually: `format:check`, `lint`, `typecheck`, `test`,
`test:integration`, `test:e2e`, `test:a11y`, `test:architecture`, `test:licenses`,
`test:deps`, `test:secrets`, `test:migrations`, `test:guardrails`, `spec:validate`, `build`.

`pnpm verify lint typecheck` runs a subset. Full table in
[ENGINEERING.md](ENGINEERING.md).

## What this repository deliberately does not contain

No secrets, no real environment values, no cloud resources, no DNS records, no GitHub remote,
no deployment. Provider integrations are ports and adapters. Everything requiring the owner's
authorization is enumerated in [docs/external-gates.md](docs/external-gates.md).

The web shell has no visual design, and that is a decision rather than an omission — see
[ADR-0007](docs/adr/0007-design-system-deferred.md).

## Licence

Private and unpublished. `UNLICENSED`. Dependency licence policy:
[docs/license-policy.md](docs/license-policy.md).
