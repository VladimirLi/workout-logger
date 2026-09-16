<!--
Mandatory PR metadata (D-010). An incomplete template is grounds for rejection on its
own — the linked intent and the evidence are what make an autonomously merged change
reviewable after the fact.
-->

## Intent

<!-- Exactly one of the following. Delete the other. -->

**OpenSpec change:** `<change-id>`
<!-- OR -->
**Maintenance rationale:** <!-- why this is not product-affecting -->

**Discovery decisions served:** <!-- D-nnn / R-nnn, or "none" -->

## OpenSpec classification

- [ ] This change **is** product-affecting and has an accepted OpenSpec change.
- [ ] This change is **not** product-affecting (tooling, docs, dependency bump, refactor
      with no behavioral change).

**Classified by:** <!-- agent/person -->
**Independently verified by:** <!-- a different principal; the implementer's own
classification is not authoritative (D-009) -->

## What changed and why

<!-- What a reviewer needs in order to judge it. Not a file list. -->

## Evidence

- [ ] `pnpm verify` passes locally
- [ ] CI `verify` is green
- [ ] New or changed behavior has tests that fail without the change
- [ ] No gate was weakened, disabled, or narrowed

<!-- Paste the verify summary, or link the CI run. -->

```
```

## Guardrails

- [ ] This change touches **no** guardrail path (see `ENGINEERING.md`).
- [ ] This change touches **only** guardrail paths, and is submitted separately from any
      product change (D-035, D-036).

## Design system

- [ ] No UI change.
- [ ] Structural or accessibility only — no visual language expressed.
- [ ] Substantive UI. **`DESIGN_SYSTEM.md` status:** <!-- must be Accepted (gate G-10) -->

## Data and security

- [ ] No schema change.
- [ ] Schema change: expand-contract compatible, `pnpm test:migrations` passes, and the
      pre-migration backup path in `docs/runbooks/pre-migration-backup.md` applies.
- [ ] No new telemetry attribute, or the attribute is on the allowlist in
      `OBSERVABILITY.md` and the canary still passes.
- [ ] No secret, credential, or real environment value is included.
- [ ] Any new dependency passes `pnpm test:licenses` and `pnpm test:deps`.

## External gates

<!-- Does this change depend on, or close, a gate in docs/external-gates.md? -->

## Risk and rollback

<!-- What breaks if this is wrong, and how it is reverted. -->
