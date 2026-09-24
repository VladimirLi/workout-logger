# Tasks

## 1. Product surfaces (MIT text and non-guardrail manifests)

- [x] 1.1 Add root `LICENSE` with MIT text, copyright `(c) 2026 Vladimir Li`
- [x] 1.2 Set `"license": "MIT"` on `apps/*` and `packages/*` except `packages/observability`
- [x] 1.3 Update `README.md` licence paragraph to MIT; note public flip still needs condition 5
- [x] 1.4 Update ADR-0009 consequence: project licence is MIT (chosen 2026-09-24); public still blocked on exception re-review
- [x] 1.5 Update `docs/external-gates.md` G-1 / G-11 notes: project licence chosen (MIT); condition 5 exception re-review still open for public
- [x] 1.6 Open product-only PR; `pnpm test:guardrails` passes; `pnpm spec:validate` passes
      (https://github.com/VladimirLi/workout-logger/pull/15 merged `f897a84`)

## 2. Guardrail manifests (separate PR)

- [x] 2.1 Set `"license": "MIT"` on root `package.json` and `packages/observability/package.json`
- [x] 2.2 Open guardrail-only PR; `pnpm test:guardrails` passes; `pnpm test:licenses` still OK
      (https://github.com/VladimirLi/workout-logger/pull/16 merged `defb979`)

## 3. Verification

- [x] 3.1 `pnpm verify` on each PR (or CI verify green)
      (#15 and #16 CI verify green before merge)
- [x] 3.2 Confirm no change to `scripts/license-decisions.mjs` / exception ledger
      (neither PR touched those paths)
- [x] 3.3 Confirm GitHub visibility remains private
      (`gh api repos/VladimirLi/workout-logger` → `private: true` on 2026-09-24)
