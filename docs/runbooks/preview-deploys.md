# Runbook: preview deployments

**Status:** Designed and written, never run. No Vercel project exists, so no preview has been
built and `preview-smoke` has not run once. Follows [ADR-0013](../adr/0013-hosting-and-deployment.md)
sections 1, 2, 3 and 5. Depends on gate G-4 in [external-gates.md](../external-gates.md).

## How a preview happens

1. A pull request is opened or updated.
2. **Vercel's GitHub integration** builds a preview of `apps/web` and protects it with Vercel
   Authentication. Vercel holds the credentials; GitHub stores no Vercel token.
3. Vercel sends a `repository_dispatch` event, `vercel.deployment.success`, with the preview URL.
4. [`preview-smoke`](../../.github/workflows/preview-smoke.yml) first checks the URL is
   `<project>-<id>-<scope>.vercel.app` for this project and Vercel scope, so the OIDC token is never
   sent elsewhere. It then checks that an anonymous request is denied (401, 403, or a redirect to
   vercel.com) and that `/today` and `/manifest.webmanifest` return exactly 2xx with a GitHub
   Actions OIDC token through Vercel Trusted Sources. Redirects are never followed.

ADR-0013 says Vercel accepts GitHub OIDC for Trusted Sources only, not for deploying, so a
workflow that deployed previews itself would need a stored `VERCEL_TOKEN`. That is why none does.

## What Vladimir must do

Each step is an account, credential or spend action, so none was attempted. Previews run on the
Hobby plan (ADR-0013 decision 1).

1. **Create the Vercel project** from `VladimirLi/workout-logger`, root directory `apps/web`,
   Node.js 22, framework Next.js. The workspace needs a pnpm install from the repository root; if
   Vercel does not detect that, tell the Platform & Reliability Engineer what the build log says.
2. **Set Preview-scope environment variables** (ADR-0013 section 5), entered in the dashboard:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`
   from the dev project (`workout-logger-dev`), the secret key marked Sensitive and **not** in
   the Development scope; `NEXT_PUBLIC_APP_ORIGIN` left to the deployment URL;
   `DEPLOYMENT_ENVIRONMENT=preview`; `OTEL_SERVICE_NAME=workout-web`. Leave
   `WEBAUTHN_RELYING_PARTY_ID` unset: passkeys are never enrolled on a preview. Put no production
   value in the Preview scope.
3. **Turn Vercel Authentication on** for Preview deployments (Settings, Deployment Protection).
4. **Turn "Auto-assign Custom Production Domains" off.** The preview does not need this, but
   ADR-0013 section 2 requires it before the first `main` build, so do it now.
5. **Add a Trusted Source** (Settings, Deployment Protection, Trusted Sources, External Services):
   GitHub Actions, account `VladimirLi`, repository `workout-logger`, applying to the **Preview**
   environment only. Leave the audience at its default, `https://github.com/VladimirLi`, which is
   what the workflow requests.
6. **Add two GitHub repository variables** (Settings, Secrets and variables, Actions, Variables):
   `VERCEL_PROJECT_NAME`, the Vercel project's name, and `VERCEL_SCOPE_SLUG`, the slug of the
   Vercel account or team that owns it (the last part of a preview hostname, before
   `.vercel.app`). The workflow ignores events from any other project and refuses any host that
   is not `<project>-<id>-<scope>.vercel.app`. Both are names, not secrets, and must be lower-case
   letters, digits and hyphens.
7. **Leave `deployment_status` events as they are.** The workflow uses `repository_dispatch`.

`repository_dispatch` runs only from the default branch's copy of the workflow, so nothing runs
until the `preview-smoke` PR is merged.

## Verifying it once the project exists

1. Run `preview-smoke` by hand with the `workflow_dispatch` input set to a preview URL.
2. Open a PR and confirm a preview builds, the dispatch arrives, and `preview-smoke` is green.
3. Break each check once and confirm it goes red: remove the Trusted Source (the OIDC check must
   fail), and turn Vercel Authentication off (the anonymous check must fail).

Record the run links on VLA-254.

## Known limits

- **Unverified against Vercel.** The `x-vercel-trusted-oidc-idp-token` header, the default
  audience, the `repository_dispatch` payload fields (`environment`, `project.name`, `url`) and the
  `success` event for a preview are taken from Vercel's documentation (read 2026-10-14), not from
  a run.
- The anonymous check accepts 401, 403 or a redirect to `https://vercel.com/`, because the answer
  Vercel gives an unauthenticated `curl` has not been observed. If the first real run shows
  another answer, change the check to that one; do not loosen it to "not 2xx".
- The hostname check proves the host is in Vladimir's Vercel scope and starts with the project
  name, not that a deployment of this commit exists. The preview hostname format is from Vercel's
  documentation, not from a run.
- Previews share one dev database (ADR-0013 section 1). The smoke test only reads pages.
- The check is not required. A red `preview-smoke` does not block merging; making it required is
  a ruleset change, which is Vladimir's.
- The workflow cannot tell a cold start from a broken deployment beyond its six attempts.
