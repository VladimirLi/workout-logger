> A task is checked only when a gate proves it; the evidence is named beside it. Everything
> unchecked is not implemented or was not run.

## 1. This change (spec)

- [x] 1.1 Spec, design and tasks written; `pnpm spec:validate` passes (command output on the PR)
- [ ] 1.2 Independent review verdict on the final SHA
- [ ] 1.3 Vladimir approves the spec on the PR (authorization change, AGENTS.md)

## 2. Implementation (separate issue, created only after 1.3)

None of these starts before the spec is approved. Provisioning and credentials are human-authorized
gates and are not part of any task here.

- [ ] 2.1 `packages/contracts`: closed exchange request (empty) and response (access token, expiry);
      test: unknown fields and a user identifier are rejected
- [ ] 2.2 `packages/application`: `exchangeSyntheticCredential` use case and the issuer port;
      tests cover credential verification, digest windows, at most two digests, and the 90-day
      bound, with the clock injected
- [ ] 2.3 `packages/adapters-supabase`: issuer adapter, with no user-id parameter (type test with
      `@ts-expect-error`), refusing a target without `app_metadata.synthetic = true`; contract
      suite against the development project
- [ ] 2.4 `apps/web`: the exchange route (404 unconfigured, 405, 401 identical bodies, 400, 503
      with `Retry-After`) and the per-request `synthetic` flag derived from the verified token
- [ ] 2.5 Tests: header, query, body, cookie and `user_metadata` cannot set the flag; a forged,
      unsigned or expired token is `synthetic=false`; a synthetic 4xx and 5xx stay `true`
- [ ] 2.6 Tests: the sentinel credential and issued token appear in no log, telemetry event, error
      body or header; telemetry canary still passes
- [ ] 2.7 Wrong-user suites (`wrong-user.provider.ts` and the boundary suites) run with the
      synthetic user as the second identity in both directions, for every relation and operation;
      a missing case fails the gate
- [ ] 2.8 Against the development project: `app_metadata` is absent from a user's own update,
      present in the issued token, and the token lifetime is at most one hour; record the
      measured Auth verification rate limit
- [ ] 2.9 `pnpm test:secrets` (which includes the bundle scan) still shows the service-role key
      absent from the client bundle
- [ ] 2.10 Runbook `docs/runbooks/synthetic-user.md`: provisioning, rotation order and the rotation
      drill, revocation, examples only
- [ ] 2.11 `pnpm verify` and CI green; independent review and QA verdicts on the final SHA

## 3. Later, blocked outside this change

- [ ] 3.1 MCP leg: synthetic MCP token under SECURITY.md rules (blocked by G-1, G-3, G-4)
- [ ] 3.2 T6 and T7 present the token on every journey step and state the synthetic data reset or
      retention rule (design, Risks)
- [ ] 3.3 T3 decides whether synthetic `auth.event` 5xx counts toward the Auth failure alert
- [ ] 3.4 T12 decides whether repeated failed exchange attempts are a security event
