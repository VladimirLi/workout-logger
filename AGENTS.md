# Agents

**Status:** Normative. This file defines who may do what. Changing it is a product-intent
change and requires human approval.
**Source:** Promoted from [docs/discovery/decision-record.md](docs/discovery/decision-record.md).

## Start here

1. Read [VISION.md](VISION.md) and [ROADMAP.md](ROADMAP.md) for intent.
2. Read [ENGINEERING.md](ENGINEERING.md) for how to build and what must pass.
3. Read [docs/adr/](docs/adr/) before proposing anything structural.
4. Check [docs/external-gates.md](docs/external-gates.md) before assuming something is
   available. Ten gates are open and no cloud resource exists.
5. If the task touches UI, read [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) first. It is a blocking
   gate.

Run `pnpm verify` before claiming anything is done.

## Authority model

The human approves **product intent**. Agents own **implementation and execution** within
the deterministic gates. Human approval is **not** required for a normal implementation
change once intent has been approved (D-005).

What still requires a human:

- Approving or changing product intent — `VISION.md`, `ROADMAP.md`, `AGENTS.md`, an ADR, or
  an OpenSpec change that alters product behavior.
- Accepting the design system (gate G-10).
- Anything security-sensitive or irreversible: credentials, cloud provisioning, DNS, the
  WebAuthn relying-party ID, production data, branch rulesets.
- Signing off a license exception (gate G-11).
- Waiving a high or critical review finding, with a durable written rationale.

## Roles

Separate identities, least-privilege credentials, and no principal both implements a
candidate and attests its review or CI result (R-023).

| Role | May | May not |
|---|---|---|
| Product / specification agent | Draft OpenSpec changes and specs | Approve product intent |
| Implementation agent | Write a branch and open a PR | Approve or merge it |
| Independent review agent | Read candidate source and evidence, issue a structured verdict | Hold any write credential |
| CI gatekeeper | Execute the gates and publish an immutable result | Approve a change |
| Release automation | Deploy an attested merge commit via short-lived OIDC | Deploy an unattested commit |
| Incident agent | Read sanitized evidence, diagnose, open a tested fix PR | Mutate production |

Execution isolation: ephemeral workspaces, no production credentials, default-denied egress
except declared endpoints, 30-minute and 200,000-token per-run limits enforced by the runner
(R-024). Exceeding a limit checkpoints and marks the task blocked — it never silently
overruns.

## Does this need an OpenSpec change?

**Yes** if it changes what the product does, what it stores, what an agent may do, or what
the user sees. **No** if it changes only how the same behavior is achieved.

| Needs a change | Does not |
|---|---|
| New or altered user-visible behavior | Refactor with identical behavior |
| New or altered stored data shape | Rename an internal symbol |
| New or altered MCP tool, scope, or schema | Faster implementation, same result |
| New telemetry attribute | Adding a test for existing behavior |
| Change to an invariant or validation rule | Fixing a typo in a comment |
| Anything touching authorization | Dependency bump with no behavior change |

**The implementing agent's classification is not authoritative** (D-009). Policy rules and an
independent reviewer must verify it. Record both the classification and who verified it in
the PR template. When genuinely unsure, write the change — a redundant spec costs an hour, an
unrecorded behavior change costs a future debugging session.

`pnpm spec:validate` must pass. Commands: `pnpm openspec list`, `pnpm openspec show <id>
--type change`, `pnpm openspec status --change <id>`.

## Rules that are not negotiable

These come from accepted decisions. An agent that finds one inconvenient should say so, not
route around it.

1. **Never weaken a gate to make it pass.** Not a threshold, not a severity level, not a
   license allowlist, not a lint rule, not a coverage number.
2. **Never modify a guardrail file in the same change as product code** (D-035).
   `pnpm test:guardrails` enforces this. Guardrail paths are listed in
   [ENGINEERING.md](ENGINEERING.md). A legitimate guardrail change is its own PR.
3. **Never claim work is complete because code exists.** Complete means a gate proves it.
4. **Never silently rebase an agent proposal.** A moved base revision is a stale rejection
   (ADR-0002).
5. **Never discard a queued workout mutation automatically** (ADR-0003).
6. **Never put workout content or agent rationale into telemetry** (OBSERVABILITY.md).
7. **Never commit a secret, a real environment value, or a credential.** Examples only.
8. **Never import an adapter from the application layer, or a framework from the domain**
   (ADR-0001). `pnpm test:architecture` enforces it.
9. **Never adopt a UI framework, palette, or type scale** while `DESIGN_SYSTEM.md` reads
   `NOT DECIDED` (ADR-0007). A scaffold default is not a decision.
10. **Never provision a cloud resource, DNS record, GitHub remote, or deployment.** Those are
    human-authorized gates.

## Working on UI

Blocked until [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) is `Accepted`.

Permitted meanwhile: routes, landmarks, focus order, semantic markup, minimum target sizes,
accessibility fixes — anything structural that expresses no visual language.

Not permitted: color, type scale, spacing system, component styling, iconography, motion,
chart styling, polished screens.

## Where a change belongs

```text
apps/web                    Next.js PWA + server routes      composition root
apps/mcp                    remote MCP transport             composition root
packages/domain             entities, value objects, rules    no framework, no IO
packages/application        use cases and ports               declares ports only
packages/contracts          versioned schemas                 schema library only
packages/adapters-supabase  provider implementations          imported only by an app
packages/observability      the only telemetry entry point
packages/test-support       builders and port contract suites
openspec/                   normative change artifacts
```

Dependency direction: `apps -> adapters -> application -> domain`, with `contracts`
alongside. Cross-package deep imports are forbidden — each package's `index.ts` is its entire
public surface.

## Commits and pull requests

Conventional commits, enforced locally by commitlint:

```text
<type>(<scope>): <lower-case subject>
```

Scopes: `domain application contracts observability adapters-supabase test-support web mcp
spec guardrail deps release repo`.

The PR template in [`.github/pull_request_template.md`](.github/pull_request_template.md) is
mandatory. An incomplete template is grounds for rejection on its own.

## Independent review

A normal implementation change requires every deterministic gate plus approval from one
independent agent reviewer (D-034). The reviewer uses a separate invocation and credential,
receives the accepted specification, the exact candidate SHA, the diff, the tests, and the
evidence — but **not** the implementer's private reasoning (R-025).

Any new commit invalidates the verdict. High and critical findings block; a waiver needs
human approval and a durable rationale.

## Honest reporting

State what passed, what failed, and what you did not do. A gate you skipped is not a gate
that passed. A task you could not finish is not a task that is done. If an external gate
blocked you, name the gate.

This matters more here than in most repositories, because changes merge without a human
reading the diff. The written record is the only account of what happened.
