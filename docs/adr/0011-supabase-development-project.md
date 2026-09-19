# 0011 — Supabase is suitable, and a development project exists

**Status:** Accepted
**Date:** 2026-09-18
**Discovery:** D-025, D-026, R-011, R-013, R-015, R-020
**Relates to:** [0005](0005-supabase-behind-adapters.md), [0009](0009-platform-repository-and-relying-party-decisions.md)

## Context

D-025 accepted Supabase for the first slice *subject to a short setup-time check that no
blocking requirement has emerged*, and docs/external-gates.md (G-2) requires the outcome of
that check to be recorded in an ADR. Until today there was nothing to check against: no
project existed and no policy had ever been executed.

On 2026-09-18 the repository owner authorised the creation and configuration of **one Supabase
Free project for development only**, including applying the committed migrations and storing
development secrets locally. The authorisation explicitly excludes production resources, any
paid upgrade, production data, DNS, passkey enrollment, and any deployment.

## Decision

**Supabase remains the persistence and authentication platform. No blocking requirement has
emerged.** The check below was performed against the development project rather than reasoned
about, and every claim in it is a read-back from the running database.

`workout-logger-dev`, project ref `vrhukqvrnlejvmpefmxl`, region `eu-west-1`, status
`ACTIVE_HEALTHY`, Postgres 17.6.1. Supabase CLI 2.117.0, linked from this repository.

### What was checked, and what it showed

1. **Migrations apply.** The initial schema applied on the first attempt.
   `supabase migration list --linked` reports the same version locally and remotely.
2. **Row-level security works as specified (R-013).** All six exposed tables exist with RLS
   enabled *and forced*, each with an owner policy. Forced matters: without it a table owner
   reading through the API would bypass the policy.
3. **Deny-by-default is proven, not assumed.** `scripts/check-rls.mjs` reads and writes every
   exposed table through PostgREST with the anonymous key. All twelve attempts are refused with
   401. This is task 2.3's unauthenticated half; the wrong-user half needs two signed-in
   identities and therefore authentication.
4. **Security-definer functions pin `search_path` (R-013).** The one in `public` is Supabase's
   own `rls_auto_enable`, an event trigger that enables RLS on any new table in `public`. It is
   `SECURITY DEFINER` with `search_path` pinned to `pg_catalog`, which is what the requirement
   asks for.

### What the check found that is worth acting on later

**Default privileges in `public` grant ALL on future tables to `anon` and `authenticated`.**
This is Supabase's own default, not something this repository configured. A table created in
`public` therefore arrives granted to anonymous callers, and is protected only by the RLS the
event trigger enables — deny-by-default rests on row-level security rather than on grants.

Every table this repository creates revoked those grants from `PUBLIC` and `anon`, and the
migration gate refused a migration that forgot to — but neither covered `authenticated`, and
that is the role a browser holds. The effective privileges on all six tables were therefore ALL
for any signed-in user, bounded by row-level security but not by the functions that own the
writes; a provider test proved it by rebasing a stored proposal as a signed-in user, which makes
a stale proposal acceptable (review of d535b3f..cc91a55, 2026-09-19).

Corrected on 2026-09-19: migration 20260919110000 revokes every write privilege on all six
tables from `PUBLIC`, `anon` and `authenticated` and grants back only SELECT, so a change
reaches the database only through a `SECURITY DEFINER` function. The gate now requires that
revocation for every table it sees created, checked across the whole migration set rather than
per file, because an applied migration is not rewritten. This still covers only what this
repository creates.

**Recommendation, deliberately not acted on here:** revoke those default privileges on the
production project before it holds data. It is a change to platform behaviour with
consequences for Supabase's own tooling, the authorisation in hand is development-only, and a
production decision belongs with the production project.

### What remains true about the Free tier

R-011 and R-015 already say the Free tier is unsuitable for production: it pauses on
inactivity and has no point-in-time recovery. That is why this project is for development, and
why ADR-0009's terms for production — a Pro project — are unchanged.

### Region

`eu-west-1` (Ireland) rather than Stockholm, which the owner preferred. No accepted requirement
names a region; the data stays in the EU. Recorded because a preference that quietly became
something else is worth being able to find later.

## Consequences

**Good.** G-2 is no longer entirely closed: a database exists, the schema is real, and
deny-by-default is a measured result. Work that needed a database to be honest can proceed.

**Bad.** There are now credentials on a developer machine. They are in `.env.local`, which is
gitignored and mode 600, and no value has been printed. The service-role key is the one that
matters: `scripts/bundle-secrets.mjs` already fails the build if anything resembling it reaches
the client bundle, and that check now has something real to catch.

**Still closed.** Production. No Pro project, no production data, no DNS, no deployment, no
passkey enrollment. The CI secrets G-2's "done when" requires do not exist either, so the
adapter and RLS suites do not yet run anywhere but a developer machine.
