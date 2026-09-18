-- The proposal statuses the domain actually has (first-vertical-slice, task 2.5; ADR-0002).
--
-- Found by running the port contract suite against the development database. The initial
-- schema allowed ('pending','accepted','rejected','stale'); the domain's statuses are
-- ('pending','accepted','rejected','rejected_stale','expired'). A vocabulary invented in SQL
-- and never compared with the domain is exactly the drift the contract suite exists to catch,
-- and it would have rejected every stale proposal at the database with a constraint error.
--
-- The decided-at constraint goes for the same reason: it required a timestamp whenever a
-- proposal was not pending, and the domain's Proposal has no such field. The database was
-- asserting something about the model that the model does not say.
--
-- Expand-only: the check constraints are widened and replaced, no column changes shape, and
-- no data exists in this development project beyond the contract suite's own rows.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE public.proposals DROP CONSTRAINT IF EXISTS proposals_decided_fields;

-- Any row written under the old vocabulary becomes the domain's name for the same thing.
UPDATE public.proposals SET status = 'rejected_stale' WHERE status = 'stale';

ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending', 'accepted', 'rejected', 'rejected_stale', 'expired'));

-- A decided proposal records when, where the caller supplied it; a pending one never does.
ALTER TABLE public.proposals
  ADD CONSTRAINT proposals_pending_has_no_decision
  CHECK (status <> 'pending' OR decided_at IS NULL);

-- The stale transition writes the domain's status.
CREATE OR REPLACE FUNCTION public.mark_proposal_stale_if_pending(
  p_user_id uuid,
  p_proposal_id text,
  p_decided_at timestamptz
) RETURNS text
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_exists boolean;
BEGIN
  UPDATE public.proposals
  SET status = 'rejected_stale', decided_at = p_decided_at
  WHERE user_id = p_user_id AND id = p_proposal_id AND status = 'pending';

  IF FOUND THEN
    RETURN 'marked';
  END IF;

  SELECT true INTO v_exists
  FROM public.proposals
  WHERE user_id = p_user_id AND id = p_proposal_id;

  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  RETURN 'not_pending';
END;
$$;
