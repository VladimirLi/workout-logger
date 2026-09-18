-- Proposal decisions as atomic operations (first-vertical-slice, task 2.5; ADR-0002, D-018).
--
-- The initial schema has been applied to the development project, so this is an expand
-- migration rather than an edit: new columns are nullable or defaulted, and nothing existing
-- changes shape.
--
-- The three functions exist because the ProposalStore port requires compare-and-set, and a
-- compare-and-set cannot be expressed as a read followed by a write over PostgREST. Each one
-- evaluates the expected state and performs the write in a single statement or transaction:
--
--   commit_proposal_decision       revision AND status must both match; may advance the plan
--   reject_proposal_if_pending     status only, because a rejection is about the proposal
--   mark_proposal_stale_if_pending status only, because staleness is true regardless of what
--                                  the revision does next
--
-- All three are SECURITY INVOKER, so row-level security still applies to the caller, and each
-- pins search_path (R-013). They take the user id as an argument and filter on it, so a client
-- that bypasses row-level security still cannot touch another user's rows by omission.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The proposal fields the domain carries that the initial schema did not (ADR-0002).
ALTER TABLE public.proposals
  ADD COLUMN IF NOT EXISTS actor_client_id text,
  ADD COLUMN IF NOT EXISTS actor_agent_id text,
  -- A digest of the inputs the agent computed from, kept as evidence.
  ADD COLUMN IF NOT EXISTS input_hash text,
  -- When the proposal stops being reviewable. How long that is remains a product question;
  -- the column records what the domain was told rather than deciding a policy here.
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 'stale' is already permitted by the status check constraint from the initial schema.

CREATE OR REPLACE FUNCTION public.commit_proposal_decision(
  p_user_id uuid,
  p_proposal_id text,
  p_status text,
  p_expected_revision bigint,
  p_expected_status text,
  p_decided_at timestamptz,
  p_advance_revision boolean
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_current_revision bigint;
  v_current_status text;
BEGIN
  -- The plan row is locked first, so a concurrent decision waits here rather than reading a
  -- revision that is about to change. This is the window D-018 is about.
  SELECT revision INTO v_current_revision
  FROM public.plans
  WHERE user_id = p_user_id AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  SELECT status INTO v_current_status
  FROM public.proposals
  WHERE user_id = p_user_id AND id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  IF v_current_status IS DISTINCT FROM p_expected_status THEN
    RETURN jsonb_build_object('kind', 'status_changed', 'currentStatus', v_current_status);
  END IF;

  IF v_current_revision IS DISTINCT FROM p_expected_revision THEN
    RETURN jsonb_build_object('kind', 'revision_changed', 'currentRevision', v_current_revision);
  END IF;

  UPDATE public.proposals
  SET status = p_status, decided_at = p_decided_at
  WHERE user_id = p_user_id AND id = p_proposal_id;

  IF p_advance_revision THEN
    UPDATE public.plans
    SET revision = revision + 1
    WHERE user_id = p_user_id AND status = 'active'
    RETURNING revision INTO v_current_revision;
  END IF;

  RETURN jsonb_build_object('kind', 'committed', 'revision', v_current_revision);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_proposal_if_pending(
  p_user_id uuid,
  p_proposal_id text,
  p_decided_at timestamptz
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_current_status text;
BEGIN
  -- One conditional update: a proposal already decided is never overwritten.
  UPDATE public.proposals
  SET status = 'rejected', decided_at = p_decided_at
  WHERE user_id = p_user_id AND id = p_proposal_id AND status = 'pending'
  RETURNING status INTO v_current_status;

  IF FOUND THEN
    RETURN jsonb_build_object('kind', 'rejected');
  END IF;

  SELECT status INTO v_current_status
  FROM public.proposals
  WHERE user_id = p_user_id AND id = p_proposal_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  RETURN jsonb_build_object('kind', 'not_pending', 'status', v_current_status);
END;
$$;

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
  SET status = 'stale', decided_at = p_decided_at
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

-- Deny by default here too: these are callable by a signed-in user, never by anon.
REVOKE ALL ON FUNCTION public.commit_proposal_decision(uuid, text, text, bigint, text, timestamptz, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_proposal_if_pending(uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_proposal_stale_if_pending(uuid, text, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.commit_proposal_decision(uuid, text, text, bigint, text, timestamptz, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_proposal_if_pending(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_proposal_stale_if_pending(uuid, text, timestamptz) TO authenticated;
