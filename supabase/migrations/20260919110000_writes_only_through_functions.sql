-- Every write goes through a function, so a caller cannot choose what the server derives.
--
-- The hardening migration (20260919090000) moved identity, revisions, transitions, timestamps
-- and replay detection inside `decide_proposal`, `mark_proposal_stale_if_pending` and
-- `apply_workout_mutation`, all of which read the rows they depend on under lock. A caller that
-- can write those rows directly gets every one of those decisions back:
--
--   * `UPDATE proposals SET base_revision = <the plan's own>` makes any stale proposal
--     acceptable, and the compare-and-set is then comparing two numbers the caller chose.
--   * `UPDATE proposals SET status = 'accepted'` decides a proposal without the function at all.
--   * `DELETE FROM idempotency_records` turns a replay back into a fresh application, which is
--     the duplicate the outbox exists to prevent; an `INSERT` forges the result a replay returns.
--   * `UPDATE workout_sessions SET status = 'active'` reopens a completed session, which the
--     domain only permits as a recorded correction (D-012).
--   * `UPDATE`/`DELETE` on session_corrections edits the record of what a value used to be.
--
-- 20260917120000 granted a narrow list, but a GRANT cannot take away what is already there:
-- Supabase's default privileges give `authenticated` ALL on tables created in `public`, and
-- that migration only revoked from `PUBLIC` and `anon`. The effective privileges were therefore
-- ALL on every table, which a provider test proved by editing rows as a signed-in user
-- (packages/adapters-supabase/src/authenticated-rpc.provider.ts).
--
-- So the write privileges are revoked and SELECT is granted back explicitly. The functions are
-- SECURITY DEFINER and keep writing, because the definer's privileges are what they use. The
-- application only ever reads directly; it delivers every change through a function.
--
-- If a later flow genuinely needs a direct write, that is a migration that says which one and
-- why, not a privilege that was never removed.

-- A privilege change takes an ACL lock on each table, so it fails rather than queues (R-016).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
  ON public.plans, public.workout_sessions, public.recorded_sets,
     public.session_corrections, public.proposals, public.idempotency_records
  FROM PUBLIC, anon, authenticated;

-- Reading is the half the application does for itself; row-level security decides whose rows.
GRANT SELECT ON public.plans TO authenticated;
GRANT SELECT ON public.workout_sessions TO authenticated;
GRANT SELECT ON public.recorded_sets TO authenticated;
GRANT SELECT ON public.session_corrections TO authenticated;
GRANT SELECT ON public.proposals TO authenticated;
GRANT SELECT ON public.idempotency_records TO authenticated;
