> A task is checked only when a gate proves it; the evidence is named beside it. Everything
> unchecked is not implemented or was not run.

## 1. This change (spec)

- [x] 1.1 Proposal, design, spec and tasks written; `pnpm spec:validate` passes (output on the PR)
- [ ] 1.2 Independent review verdict on the final SHA
- [ ] 1.3 Vladimir approves the spec on the PR, including the two decisions named in the proposal
      (does this satisfy D-049 for the security class; A, B or C for interactive sign-in)

## 2. Implementation (separate issues, created only after 1.3)

None of these starts before the spec is approved. No task provisions a cloud resource or requests a
credential; production credentials are G-9 and Grafana accounts are T3. The guardrail PR (2.1) is
its own PR and never shares a change with product code (D-035).

- [ ] 2.1 **Guardrail PR, `packages/observability` and its docs.** `security.outcome`,
      `security.event`, `SECURITY_OUTCOMES`, the mapping, the tests listed in the design (domain,
      cardinality, wire canary), `OBSERVABILITY.md` tables, section 2.1 of the telemetry design and
      the allowlist sentence in the `telemetry-privacy` spec. Depends on T1 for the OTLP exporter;
      the allowlist part does not.
- [ ] 2.2 **Product PR, `apps/mcp`.** A pure mapping from each `AuthorizationFailure` kind to
      `mcp_token_rejected` or "not recorded", and the call at the refusal point, behind
      `Telemetry.record` only. Tests: one per failure kind (the table in the design); telemetry
      throwing leaves the decision unchanged; telemetry absent leaves the decision unchanged.
      `pnpm test` passes. Depends on 2.1.
- [ ] 2.3 **Product PR, synthetic exchange.** Record `synthetic_credential_rejected` at the refusal
      branch of the route defined by `add-synthetic-user`; tests for an unknown digest, an expired
      digest, a success that records nothing, and a body field that is not read as the outcome.
      Depends on 2.1 and on the `add-synthetic-user` implementation.
- [ ] 2.4 Canary: a sentinel token, client id, email and user agent beside a refusal reach no exported
      event, label, resource attribute, header or body (extends the existing canary; part of 2.1's
      gate once 2.2 exists).
- [ ] 2.5 Transport detail, when the MCP transport is built (blocked by G-1 to G-4): signature,
      issuer and revocation failures record `mcp_token_rejected`; record in the PR whether
      revocation is distinguishable from invalidity.

## 3. Later, blocked outside this change

- [ ] 3.1 Alert rule "Credential rejected", routed A and B, NoData = OK. Blocked by T3 (Grafana
      stack, tokens, contact points; human-authorized).
- [ ] 3.2 Drill against a non-production stack, four steps in the design, recorded in
      `docs/runbooks/` and signed off by a principal other than the runner. Blocked by 3.1.
- [ ] 3.3 Interactive sign-in: after Vladimir's decision. If B, first a read-only check that
      Supabase exposes refused verifications and for how long; any credential it needs is a G-9
      request made by the Chief of staff, not by this change. If A, its own spec and ADR. If C, a
      written change to D-049 and OBSERVABILITY.md that only Vladimir can approve.
- [ ] 3.4 Update the D-049 table in section 6 of the telemetry design and `docs/external-gates.md`:
      security covered only after 3.2; authentication stays partial for the interactive path until
      3.3. G-5 stays open.
- [ ] 3.5 `pnpm verify` and CI green on each implementation PR; independent review and QA verdicts
      on each final SHA.
