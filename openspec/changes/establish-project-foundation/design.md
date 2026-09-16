## Context

The discovery record accepted 50 decisions and 29 research-derived requirements, then said
explicitly: *"Do not copy this draft wholesale into the repository without reconciling its
provisional assumptions and open decisions."*

The hard constraint shaping every choice below is D-005 and D-034: an agent may merge a
normal implementation change with no human reviewing the diff. That only works if the
boundaries are machine-enforced and the gates demonstrably catch real violations. A gate
that looks green because it matches nothing is worse than no gate, because it buys
confidence it has not earned.

## Goals / Non-Goals

**Goals:**

- Normative repository artifacts an agent can read instead of re-deriving intent.
- A package structure where the layering violations are impossible to merge, not merely
  discouraged.
- A gate suite where every gate has been shown to fail on a real violation.
- Honest reporting of what is not yet verifiable, in one place an agent will find.

**Non-Goals:**

- Any product feature. No persistence, no authentication, no offline queue, no serving MCP
  endpoint, no product UI.
- Any visual design. Deliberately deferred; see the `decide-design-system` change.
- Provisioning any cloud resource, DNS record, GitHub remote, or deployment.
- Two working provider implementations. Portability here is structural (D-026).

## Decisions

### Convert discovery into layered documents, not one policy file

Seven documents plus seven ADRs, rather than one. Agents read selectively, and a single
2000-line policy file gets skimmed. The split follows audience: `VISION.md` and `ROADMAP.md`
for intent, `SECURITY.md` and `OBSERVABILITY.md` for the controls, `ENGINEERING.md` for
mechanics, `DESIGN_SYSTEM.md` as a blocking gate, ADRs for the decisions someone will want
to re-litigate.

**Rejected:** copying the discovery record into `openspec/` as the normative source. It
mixes accepted with provisional and proposed statuses, and it is evidence of how we decided —
which is worth preserving unchanged rather than editing into a spec.

### One formatter and linter, not Prettier plus ESLint

Biome. One tool, one config, one pass. The cost is losing `eslint-config-next`'s
framework-specific rules. The benefit is a gate that runs in ~15 ms across 84 files and a
dependency tree small enough to license-audit honestly.

**Rejected:** ESLint 9 flat config plus typescript-eslint plus Prettier. Three tools, three
configs, and roughly 40 extra transitive packages for rules the architecture gate and strict
TypeScript already cover.

### TypeScript 6.0.3, not 7.0.2

TypeScript 7.0.2 is the current `latest` and it typechecked this repository cleanly. It was
still rejected: dependency-cruiser 18.3.1 declares support for `typescript >=2.0.0 <7.0.0`,
and under TypeScript 7 it silently fell back to a non-TypeScript parser, cruising **1
module** instead of 36 while reporting success. Every layering rule was inert.

A newer compiler is not worth a blind architecture gate. Pinned to 6.0.3, the last stable
line dependency-cruiser supports. Revisit when dependency-cruiser publishes TypeScript 7
support.

### Cross-package resolution must reach source, not `dist/`

Discovered the same way. With standard `exports`, a cross-package import resolved to the
other package's built `dist/`, which the cruise excludes — so `application-no-adapters` and
`only-apps-import-adapters` matched nothing while the gate reported zero violations.

Fixed by adding a `"source"` export condition to each package and putting it first in
dependency-cruiser's `conditionNames`. Runtime resolution is unchanged, because nothing else
requests that condition.

**Consequence:** `scripts/architecture-gate.test.ts` now tests the *gate*, not the
architecture. It writes deliberate violations, asserts rejection, asserts a legal import
still passes, and asserts the graph size exceeds 25 modules. This class of failure — a
silently vacuous rule — is the one most likely to recur.

### Gates that are not yet applicable must say so, not stub out

`pnpm test:migrations` and `pnpm test:guardrails` cannot do their real work yet: no database
and no remote. Both detect that condition specifically, print which external gate covers it,
and enforce fully the moment the condition changes. Verified in both directions.

**Rejected:** omitting them until they are useful. Then nobody notices when the condition
changes. Also rejected: stubs that always exit 0, which are indistinguishable from a passing
check.

### License findings become recorded exceptions, not a wider allowlist

The gate found 13 components outside R-029's allowlist. Each got a real linkage analysis
rather than a new allowlist entry. The load-bearing fact: **this product is not distributed**
— privately hosted, single-user, no published package — so obligations that attach on
distribution are not triggered.

Two are runtime-classified (`caniuse-lite`, CC-BY-4.0 build-time data; `sharp`'s libvips
binary, LGPL-3.0-or-later, unmodified and dynamically linked server-side). The rest are dev
tooling.

R-029 requires a **named approver**, and an agent's licence analysis is not a substitute for
a human's. The gate therefore fails closed on an unapproved entry (exit 3) rather than
honouring it. The owner approved all twelve on 2026-09-16, conditionally, through
2027-09-16 (gate G-11), and the gate now enforces the conditions: exact version, scope and
licence per entry, no distribution vector, no modification of an excepted dependency, and an
approver name counting only when a recorded decision lists the exact component.

### `vitest` is a peer dependency of `test-support`

Declaring it as a dependency put vitest's whole tree — including MPL-2.0 `lightningcss` —
into the *runtime* license scope of a package that never ships. A peer plus dev pair
classifies it correctly. The license gate surfaced this; it is a real modelling fix, not a
workaround.

### Secret scanning must name dotfiles explicitly

`secretlint "**/*"` does not match dotfiles. A live credential in `.env.production` passed
the gate. The pattern list now includes `"**/.*"` and `"**/.*/**/*"`, verified by planting a
credential in a tracked dotfile and in a dot-directory.

This is the third instance of the same failure mode in this change: a gate that ran, exited
0, and checked less than it appeared to.

### One browser, one viewport for now

Chromium at a phone viewport. R-007's full visual-regression matrix — two phone sizes, light
and dark, 200 % text, pinned fonts — belongs with the accepted design system. Baselines
captured against an unstyled shell would be discarded immediately.

## Risks / Trade-offs

**"CI is authoritative" is not yet true.** Branch protection, required checks, signed
commits, and linear history are GitHub-side state and no remote exists. Until G-1 closes the
workflows are advisory. Recorded in ADR-0006 rather than implied to be working.

**Thirteen license exceptions rest on non-distribution.** If the product is ever published,
shipped as a binary, or opened to an external user, every exception needs re-analysis
*before* release. Stated in `docs/license-policy.md` and G-11.

**`pnpm test:deps` needs network.** It fails closed when the registry is unreachable, which
means an offline machine cannot complete `pnpm verify`. Accepted: a vulnerability gate that
silently checks nothing is the worse failure.

**Biome lacks Next.js-specific lint rules.** Mitigated by strict TypeScript, the
architecture gate, and the accessibility gate. Revisit if a class of Next.js mistake escapes.

**The shell looks unfinished.** Intentional and stated on the page itself. Making it look
finished before the design decision exists is exactly what ADR-0007 prevents.

**Coverage is enforced only on `domain` and `observability`.** Deliberate, per D-038: a
global percentage would reward padding skeletons. The risk is that a future package with
real behaviour is added without a threshold.

## Open Questions

- ~~Who approves the license exceptions?~~ Resolved 2026-09-16: the owner approved all
  twelve conditionally through 2027-09-16 (G-11). Whether the non-distribution assumption
  holds for the eventual hosting model is still open (G-4).
- Does Supabase still satisfy the first slice, per the setup-time check D-025 requires? (G-2)
- Does the WebAuthn relying-party ID bind to `gym.vladimirli.com` or to the apex? One-way
  door before any passkey enrollment. (G-3)
