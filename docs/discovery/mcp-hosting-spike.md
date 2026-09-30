# MCP hosting spike: Vercel Functions vs a small container host

**Status:** Recommendation for Vladimir's approval. Not a decision. Time-boxed to one session.
**Date:** 2026-09-30
**Serves:** VLA-253, [ADR-0013](../adr/0013-hosting-and-deployment.md), gate G-4
**Question:** where should `apps/mcp` run, without blocking the web deploy on the answer?

## Recommendation

**Run `apps/mcp` as a second Vercel project (Vercel Functions, Fluid compute).** It reuses the
web app's deploy, promote, and rollback mechanism from ADR-0013, and the workload (a stateless
request/response server for one user) is what Functions do well. Marginal cost is about zero.

**Fall back to a small container on Fly.io** if any of these turns out to matter: a single
request must stream for more than 800 s; the server needs process-level state between requests;
the Vercel adapter for the MCP SDK proves unreliable in a real test; or the second Vercel
project's rollback story is not good enough once drilled.

The web app deploys regardless. Nothing in ADR-0013 sections 1-5 depends on this choice.

## What `apps/mcp` needs from a host

From R-020, R-021, and D-045:

| Need | Why |
|---|---|
| HTTPS at a stable public URL | It is an OAuth 2.1 protected resource; the URL is the audience (`MCP_RESOURCE_IDENTIFIER`) |
| Serve `/.well-known/oauth-protected-resource` and answer 401 with a `WWW-Authenticate: Bearer resource_metadata=...` challenge | RFC 9728 discovery, so clients can find the authorization server |
| Validate a bearer token on **every** request | 15-minute tokens, re-authorization per invocation (R-020, R-021) |
| Streamable HTTP with request-scoped SSE | Tool calls may stream progress and the final result on one response |
| No dependence on in-memory sessions | Otherwise a rollback or a scale-out breaks live sessions |
| Deploy on merge, automatic rollback, MCP smoke test | D-042, D-043, D-045 |

## Evidence

### Local experiment (what was measured, and what it does not show)

A throwaway server (kept outside the repo; ~60 lines, not committed as product code) using
`@modelcontextprotocol/sdk` 1.30.1, which `apps/mcp` already depends on:

- **Stateless:** a new `McpServer` and a `WebStandardStreamableHTTPServerTransport` with
  `sessionIdGenerator: undefined` for every request. No session ID is issued or required.
- **Resource server:** a request without a bearer token gets `401` and a
  `WWW-Authenticate: Bearer resource_metadata=...` header; with a token it proceeds.
- **Streaming:** a `slow` tool emits five `notifications/message` events, one per second.

Results on Node 26.7 on a laptop:

| Observation | Result |
|---|---|
| Unauthenticated `POST` | `401` with the resource-metadata challenge |
| `tools/list` with a token, first request after start | `200` in 11.6 ms; spawn to first authorized response 327 ms including 50 ms polling |
| `tools/list`, warm | `200` in 2.4 ms |
| 5 s tool call, no session | Five progress events arrived one second apart, in order, then the result. The stream was incremental, not buffered |
| Process start to listening, imports included | 99 ms |

**What this shows.** The SDK's web-standard transport runs statelessly with no session store,
so a host that only offers "a function that takes a `Request` and returns a `Response`"
suffices, and progress streaming works without sessions.

**What this does not show.** It does not measure any hosting platform's cold start, network,
or streaming behaviour through a proxy. It ran on Node 26, not the Node 22 a platform would use.
The 327 ms and 99 ms figures are local process figures and must not be read as a platform cold
start. Whether Vercel or Fly.io buffers or cuts a stream was not tested, because nothing may be
deployed (AGENTS.md rule 10).

### Documentation review (2026-09-30, not exercised)

- Vercel Functions on Fluid compute: default 300 s, configurable to 800 s on Pro, 1800 s in
  beta; Hobby is 300 s. Multiple requests share one instance. Bytecode caching and pre-warming
  apply to **production** deployments only, so previews cold-start slower than production.
  Vercel does not publish a cold-start number.
- Vercel Hobby: 1,000,000 function invocations, 4 CPU-hours active CPU, and 360 GB-hours of
  provisioned memory per month included; restricted to non-commercial personal use.
- Vercel Trusted Sources accepts a GitHub Actions OIDC token to reach a protected deployment.
  Promote and rollback still need a Vercel token (ADR-0013 section 3).
- MCP spec 2026-07-28 (per the SDK's v2 release notes) removes sessions and scopes SSE to a
  request. That matches the stateless model above and favours function hosting.

## Comparison

| | Vercel Functions (Fluid) | Fly.io container | Google Cloud Run | Railway |
|---|---|---|---|---|
| OAuth resource server | Yes: routes and headers under our control; needs a stable public URL per project | Yes | Yes | Yes |
| Streaming / long requests | SSE works; 300 s default, **800 s max on Pro** (300 s Hobby) | Long-lived process; request limits through Fly's proxy not checked | Configurable request timeout (maximum not re-checked) | Not checked |
| Cold start | Fluid pre-warms production and caches bytecode; no published figure; **not measured** | None if a machine is kept running; a scale-to-zero machine cold-starts (not measured) | Scale to zero cold-starts unless `min-instances` is 1 (not measured) | Always-on by default, so none |
| Deploy on merge | Same Git integration and release job as web | New pipeline: `fly deploy` from CI with a Fly deploy token (a second static credential) | New pipeline plus GCP identity; supports GitHub OIDC (workload identity federation) | New pipeline; Railway token |
| Rollback | `vercel rollback`, same as web | `fly deploy` a previous image; scripted by us | Route traffic to a previous revision; scripted | Redeploy previous deployment |
| Adds an account or vendor | No | Yes | Yes (GCP billing, IAM) | Yes |
| Work needed in `apps/mcp` | Adapter from Vercel's handler to a web-standard `Request`/`Response` (the server file is a skeleton today) | Node HTTP server, close to the current `start` script | Container image plus HTTP server | Same as Fly |

Container-host rows other than Fly's price were not verified against current documentation; treat them as fallback context. Cloud Run's row for OIDC is the one place a container host genuinely fits AGENTS.md's
"short-lived OIDC" wording better than Vercel. It comes with a new cloud account, IAM setup, and
billing. That is a real cost for a single-user project and it is not recommended on that
ground alone.

## Cost

Single user, assumed 1,000 MCP calls per day, about 50 ms of CPU each. That is a planning
assumption, not a measurement.

| Option | Monthly | Basis |
|---|---|---|
| Vercel, second project on the same team | About $0 above the web plan | About 30,000 calls and roughly 0.4 active CPU-hours a month, against 1,000,000 invocations and 4 CPU-hours included on Hobby. Pro is $20/month with $20 of included usage, and it is the same subscription the web app needs |
| Fly.io, `shared-cpu-1x` 256 MB, always on | About $1.73, plus about $2 for a dedicated IPv4 if wanted | Fly's published machine pricing when researched; pay-as-you-go |
| Cloud Run | Probably inside the free tier at this volume | Not verified: the price figures obtained during research were unreliable and were discarded. Confirm before relying on it |
| Railway Hobby | About $5 | Plan price as researched; includes $5 of usage |

For reference, the other recurring cost in this decision is not hosting: a production Supabase
Pro project is about $25/month (ADR-0013 open decision 5). The hosting choice moves the total by
$0 to $5 a month; the decision should be made on operational fit, not price.

Vercel figures other than the Hobby allowances above were not re-verified on the pricing page;
prices and allowances change and should be confirmed when the account is created.

## Open questions this spike could not close

1. **MCP SDK line.** `apps/mcp` uses `@modelcontextprotocol/sdk` 1.30.1 (1.31.0 exists). The v2
   packages (`@modelcontextprotocol/server`, `mcp-handler` 2.x) reference spec 2026-07-28. The
   v1.31.0 notes only mention OAuth credential binding, and no 1.x support timeline was found.
   Whether 1.x will speak the new spec is unknown. This affects which adapter a Vercel deploy
   would use, not which host is chosen. It should be settled before the first MCP change.
2. **Platform cold start and stream-through behaviour**, for both Vercel and Fly.io, are
   unmeasured. They can be measured only after Vladimir authorises a deployment, and should be
   the first task of the MCP deploy work.
3. **Rollback** for the second Vercel project has not been drilled, same as the web app.
4. Whether **Trusted Sources** is available on Vladimir's Vercel plan was not confirmed.

## Open decisions for Vladimir

Same list as [ADR-0013](../adr/0013-hosting-and-deployment.md#open-decisions-for-vladimir), with
the MCP items highlighted.

1. Vercel plan tier: Hobby or Pro. Recommended: Pro.
2. Accept one scoped Vercel token in place of OIDC for promote and rollback, and amend AGENTS.md
   and G-4 "done when".
3. **MCP host.** Recommended: second Vercel project. Fallback: Fly.io.
4. **MCP SDK line:** stay on 1.x or move to v2.
5. Production Supabase Pro project (about $25/month) and revoking default `anon`/`authenticated`
   privileges before it holds data.
6. Domain, DNS, Vercel project, `production` GitHub environment, token, Trusted Sources entry.
7. Repository visibility for attestation (G-7).
