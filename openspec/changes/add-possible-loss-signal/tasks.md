> A task is checked only when a gate proves it; the evidence is named beside it. Everything
> unchecked is not implemented or was not run.

## 1. This change (spec)

- [x] 1.1 Proposal, design, spec and tasks written; `pnpm spec:validate` passes (output on the PR)
- [ ] 1.2 Independent review verdict on the final SHA
- [ ] 1.3 Vladimir approves the spec on the PR, including the two decisions named in the proposal

## 2. Implementation (separate issues, created only after 1.3)

None of these starts before the spec is approved. No task here provisions a cloud resource or asks
for a credential; production credentials are G-9 and Grafana accounts are T3.

Order: 2.1 before 2.2; 2.3 before 2.5; the guardrail PRs (2.1, 2.3, 2.7) are each their own PR and
never share a change with product code (D-035).

- [ ] 2.1 **Guardrail PR, `scripts/`.** Add the new function to `check-db-boundary.mjs` and to the
      ADR-0012 invariant matrix as reachable by the check role only; the gate still fails on any
      other unlisted function. Test: a function granted to `authenticated` and not listed still
      fails the gate.
- [ ] 2.2 **Product PR, `supabase/migrations/`, `packages/test-support`.** The count-only function
      (one statement, the table in the design), the read-only role and its grant, and a builder
      that removes a row a ledger entry names. Tests on a scratch Postgres: every scenario under
      "Accepted workout mutations are checked against stored facts" and "The check is read-only",
      including the removed-user, tombstone and null-payload cases and a before/after row-count
      comparison. `pnpm test:migrations` passes.
- [ ] 2.3 **Guardrail PR, `packages/observability` and its docs.** `integrity.outcome`,
      `integrity.check`, `INTEGRITY_OUTCOMES`, the mapping, the tests listed in the design
      (domain, cardinality, wire canary), `OBSERVABILITY.md` tables, section 2.1 of the telemetry
      design, and the allowlist sentence in the `telemetry-privacy` spec. Depends on T1 for the
      OTLP exporter; the allowlist part does not.
- [ ] 2.4 **Product PR, `packages/application`, `packages/adapters-supabase`.** The use case with
      three attempts and backoff (injected clock), the port, the adapter and its contract suite
      against the development project. Tests: `ok`, `mutation_missing`, `check_failed`, one dropped
      connection, no `ok` on failure.
- [ ] 2.5 Canary: sentinel exercise name and notes in a deliberately missing set reach no exported
      event, label, resource attribute, header or body (extends the existing canary; part of 2.3's
      gate once 2.4 exists).
- [ ] 2.6 Runbook `docs/runbooks/integrity-check.md`: what the outcomes mean, how an operator finds
      the missing entries under the owner role, recovery from the last pre-migration dump and its
      limits, the unverified `BYPASSRLS` boundary. Examples only.
- [ ] 2.7 **Guardrail PR, `.github/workflows/`.** Scheduled run (at most 6 hours apart) and the
      `if: always()` post-migration step in `database-migrate` that fails the job on a non-zero
      count or a failed check. Mechanism per the design's recommendation or a recorded alternative.
- [ ] 2.8 Update `docs/design/telemetry-and-synthetic-checks.md` section 6: the two alert rows and
      the D-049 table row for possible data loss, in the PR that ships the rules (T3 style).

## 3. Later, blocked outside this change

- [ ] 3.1 Alert rules (possible data loss, integrity check silent), both routed A and B. Blocked by
      T3 (Grafana stack, tokens, contact points; human-authorized).
- [ ] 3.2 Drill against a non-production stack, five steps in the design, recorded in
      `docs/runbooks/` and signed off by a principal other than the runner. Blocked by 3.1.
- [ ] 3.3 A production run of the check needs a scoped production read credential (G-9). Not
      requested here.
- [ ] 3.4 Record in `docs/external-gates.md` that the possible-data-loss class has a signal, an
      alert and a drill, only after 3.2. G-5 stays open for T12 and the rest of the breakdown.
- [ ] 3.5 `pnpm verify` and CI green on each implementation PR; independent review and QA verdicts
      on each final SHA.
