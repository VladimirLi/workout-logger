-- The server decides; the caller only asks (review of d535b3f..cc91a55, findings 1-4).
--
-- The functions this replaces took the answer as arguments. A caller chose the expected
-- revision, the target status, the decision time, whether to advance the plan, and the
-- fingerprint its own payload would be compared against - and `authenticated` is a role a
-- browser holds. Every one of those is now derived from rows the function locks, or from the
-- request's own identity, and the caller expresses only an intent.
--
-- Three changes of shape:
--
--   the user comes from auth.uid(), never from a parameter, so a caller cannot act for anyone
--   else even if row-level security were misconfigured;
--
--   SECURITY DEFINER, because the previous SECURITY INVOKER version updated a table
--   `authenticated` has no UPDATE on - it could not have worked for a signed-in user at all,
--   and the earlier tests missed it by calling with the service role. Every statement filters
--   by the derived user, since a definer function bypasses row-level security;
--
--   the mutation is validated against a closed shape before anything is written, and the
--   stored payload is what a later delivery is compared against.
--
-- Additive: the previous migrations are untouched. The old functions are dropped and replaced,
-- and one column is added.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- The payload a key was first used for, so a conflict is decided by comparing the real thing.
ALTER TABLE public.idempotency_records
  ADD COLUMN IF NOT EXISTS mutation jsonb;

DROP FUNCTION IF EXISTS public.commit_proposal_decision(uuid, text, text, bigint, text, timestamptz, boolean);
DROP FUNCTION IF EXISTS public.reject_proposal_if_pending(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.mark_proposal_stale_if_pending(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.apply_workout_mutation(uuid, uuid, text, jsonb);

-- Validation --------------------------------------------------------------------------------

/**
 * A measurement the domain could have produced (ADR-0004).
 *
 * Structural, not a reimplementation of the domain: the profile is one of three, the numbers
 * are numbers of the right sign, and a unilateral result names its side and what its load
 * counts. Whether combined load is permitted for THIS exercise is decided by the caller of
 * this function, which holds the session.
 */
CREATE OR REPLACE FUNCTION public.is_valid_measurement(p_measurement jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
DECLARE
  v_profile text;
BEGIN
  IF p_measurement IS NULL OR jsonb_typeof(p_measurement) <> 'object' THEN
    RETURN false;
  END IF;
  IF (p_measurement ->> 'schemaVersion') IS DISTINCT FROM '1' THEN
    RETURN false;
  END IF;

  v_profile := p_measurement ->> 'profile';

  IF v_profile = 'strength' OR v_profile = 'unilateral_strength' THEN
    IF (p_measurement ->> 'repetitions') !~ '^[1-9][0-9]*$' THEN
      RETURN false;
    END IF;
    IF p_measurement ? 'load' THEN
      IF (p_measurement -> 'load' ->> 'unit') <> 'kg' THEN RETURN false; END IF;
      IF (p_measurement -> 'load' ->> 'value') !~ '^[0-9]+(\.[0-9]+)?$' THEN RETURN false; END IF;
    END IF;
    IF v_profile = 'unilateral_strength' THEN
      IF (p_measurement ->> 'side') NOT IN ('left', 'right', 'both', 'alternating') THEN
        RETURN false;
      END IF;
      IF (p_measurement ->> 'loadSemantics') NOT IN ('per_side', 'total') THEN
        RETURN false;
      END IF;
    END IF;
    RETURN true;
  END IF;

  IF v_profile = 'cardio' THEN
    IF (p_measurement -> 'duration' ->> 'unit') <> 's' THEN RETURN false; END IF;
    IF (p_measurement -> 'duration' ->> 'value') !~ '^[0-9]+(\.[0-9]+)?$' THEN RETURN false; END IF;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Deciding a proposal -------------------------------------------------------------------------

/**
 * The user accepts or rejects a proposal. Nothing else is expressible.
 *
 * The base revision comes from the stored proposal, the current revision from the locked plan,
 * the time from the server's clock, and whether the plan advances from the decision itself.
 * An expired proposal is not decidable and is recorded as expired.
 */
CREATE OR REPLACE FUNCTION public.decide_proposal(p_proposal_id text, p_decision text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_plan_revision bigint;
  v_status text;
  v_base_revision bigint;
  v_expires_at timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'a decision needs a signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_decision NOT IN ('accept', 'reject') THEN
    RAISE EXCEPTION 'unknown decision %', COALESCE(p_decision, 'null')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT revision INTO v_plan_revision
  FROM public.plans
  WHERE user_id = v_user AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  SELECT status, base_revision, expires_at
  INTO v_status, v_base_revision, v_expires_at
  FROM public.proposals
  WHERE user_id = v_user AND id = p_proposal_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN jsonb_build_object('kind', 'status_changed', 'currentStatus', v_status);
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at <= v_now THEN
    UPDATE public.proposals
    SET status = 'expired', decided_at = v_now
    WHERE user_id = v_user AND id = p_proposal_id;
    RETURN jsonb_build_object('kind', 'expired');
  END IF;

  IF p_decision = 'accept' THEN
    -- The proposal's own base revision against the plan's, both read under lock.
    IF v_base_revision IS DISTINCT FROM v_plan_revision THEN
      RETURN jsonb_build_object('kind', 'revision_changed', 'currentRevision', v_plan_revision);
    END IF;

    UPDATE public.proposals
    SET status = 'accepted', decided_at = v_now
    WHERE user_id = v_user AND id = p_proposal_id;

    UPDATE public.plans
    SET revision = revision + 1
    WHERE user_id = v_user AND status = 'active'
    RETURNING revision INTO v_plan_revision;

    RETURN jsonb_build_object('kind', 'committed', 'revision', v_plan_revision);
  END IF;

  -- A rejection is about the proposal's content, so it never reads or advances the revision.
  UPDATE public.proposals
  SET status = 'rejected', decided_at = v_now
  WHERE user_id = v_user AND id = p_proposal_id;

  RETURN jsonb_build_object('kind', 'committed', 'revision', v_plan_revision);
END;
$$;

/**
 * Staleness is true regardless of what the revision does next, so this is status-only and
 * never reads it. Idempotent, and never overwrites a decision already made.
 */
CREATE OR REPLACE FUNCTION public.mark_proposal_stale_if_pending(p_proposal_id text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_exists boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'marking stale needs a signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.proposals
  SET status = 'rejected_stale', decided_at = now()
  WHERE user_id = v_user AND id = p_proposal_id AND status = 'pending';
  IF FOUND THEN
    RETURN 'marked';
  END IF;

  SELECT true INTO v_exists
  FROM public.proposals
  WHERE user_id = v_user AND id = p_proposal_id;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;

  RETURN 'not_pending';
END;
$$;

-- Applying a device mutation --------------------------------------------------------------------

/**
 * One delivery from a device's outbox: the key and the mutation commit together.
 *
 * The payload is validated before anything is written, and stored, so a later delivery under
 * the same key is compared against what was actually applied rather than against a digest the
 * caller supplied.
 */
CREATE OR REPLACE FUNCTION public.apply_workout_mutation(p_key uuid, p_mutation jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_existing public.idempotency_records%ROWTYPE;
  v_kind text;
  v_session jsonb;
  v_set jsonb;
  v_session_id text;
  v_session_status text;
  v_combined text[];
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'a delivery needs a signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_key IS NULL OR p_mutation IS NULL OR jsonb_typeof(p_mutation) <> 'object' THEN
    RAISE EXCEPTION 'a delivery needs a key and a mutation object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_kind := p_mutation ->> 'kind';
  IF v_kind IS NULL OR v_kind NOT IN ('start_session', 'record_set', 'complete_session') THEN
    RAISE EXCEPTION 'unknown mutation kind %', COALESCE(v_kind, 'null')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Claim the key. A concurrent delivery of the same key waits here and then finds the record,
  -- which is what makes exactly-once true under a retry storm rather than a polite client.
  INSERT INTO public.idempotency_records (user_id, key, request_fingerprint, mutation, result)
  VALUES (v_user, p_key, md5(p_mutation::text), p_mutation, '{}'::jsonb)
  ON CONFLICT (user_id, key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.idempotency_records
    WHERE user_id = v_user AND key = p_key
    FOR UPDATE;

    -- The payload itself, not a digest the caller chose.
    IF v_existing.mutation IS DISTINCT FROM p_mutation THEN
      RETURN jsonb_build_object('kind', 'key_reused');
    END IF;
    RETURN jsonb_build_object('kind', 'replayed', 'result', v_existing.result);
  END IF;

  IF v_kind = 'start_session' THEN
    v_session := p_mutation -> 'session';
    IF v_session IS NULL
      OR COALESCE(v_session ->> 'id', '') = ''
      OR COALESCE(v_session ->> 'planId', '') = ''
      OR COALESCE(v_session ->> 'scheduledSessionId', '') = ''
      OR (v_session ->> 'planRevision') !~ '^[1-9][0-9]*$'
      OR (v_session ->> 'startedAt') IS NULL
    THEN
      RAISE EXCEPTION 'malformed start_session' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.plans
      WHERE user_id = v_user AND id = v_session ->> 'planId' AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'no active plan % for this user', v_session ->> 'planId'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    INSERT INTO public.workout_sessions (
      user_id, id, plan_id, plan_revision, scheduled_session_id,
      exercise_ids, combined_load_exercises, started_at, status
    )
    VALUES (
      v_user,
      v_session ->> 'id',
      v_session ->> 'planId',
      (v_session ->> 'planRevision')::bigint,
      v_session ->> 'scheduledSessionId',
      COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_session -> 'exerciseIds')), ARRAY[]::text[]),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(v_session -> 'combinedLoadExercises')),
        ARRAY[]::text[]
      ),
      (v_session ->> 'startedAt')::timestamptz,
      'active'
    );
    v_result := jsonb_build_object('sessionId', v_session ->> 'id');

  ELSIF v_kind = 'record_set' THEN
    v_session_id := p_mutation ->> 'sessionId';
    v_set := p_mutation -> 'set';
    IF v_set IS NULL
      OR COALESCE(v_session_id, '') = ''
      OR COALESCE(v_set ->> 'setId', '') = ''
      OR COALESCE(v_set ->> 'exerciseId', '') = ''
      OR (v_set ->> 'sequence') !~ '^[1-9][0-9]*$'
      OR (v_set ->> 'recordedAt') IS NULL
      OR NOT public.is_valid_measurement(v_set -> 'measurement')
    THEN
      RAISE EXCEPTION 'malformed record_set' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT status, combined_load_exercises
    INTO v_session_status, v_combined
    FROM public.workout_sessions
    WHERE user_id = v_user AND id = v_session_id
    FOR UPDATE;

    IF NOT FOUND OR v_session_status <> 'active' THEN
      -- A completed session's facts are immutable; a correction is an audited revision (D-012).
      RAISE EXCEPTION 'no active session % to record into', v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;

    IF (v_set -> 'measurement' ->> 'profile') = 'unilateral_strength'
      AND (v_set -> 'measurement' ->> 'loadSemantics') = 'total'
      AND NOT ((v_set ->> 'exerciseId') = ANY (v_combined))
    THEN
      -- The same rule the domain enforces: combined load only where the plan permitted it.
      RAISE EXCEPTION 'combined load is not permitted for %', v_set ->> 'exerciseId'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.recorded_sets (
      user_id, set_id, session_id, sequence, exercise_id, measurement, recorded_at
    )
    VALUES (
      v_user,
      v_set ->> 'setId',
      v_session_id,
      (v_set ->> 'sequence')::integer,
      v_set ->> 'exerciseId',
      v_set -> 'measurement',
      (v_set ->> 'recordedAt')::timestamptz
    );
    v_result := jsonb_build_object('setId', v_set ->> 'setId');

  ELSE
    v_session_id := p_mutation ->> 'sessionId';
    IF COALESCE(v_session_id, '') = '' OR (p_mutation ->> 'completedAt') IS NULL THEN
      RAISE EXCEPTION 'malformed complete_session' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    UPDATE public.workout_sessions
    SET status = 'completed',
        completed_at = (p_mutation ->> 'completedAt')::timestamptz,
        synchronized_at = now(),
        facts_revision = 1
    WHERE user_id = v_user AND id = v_session_id AND status = 'active';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no active session % to complete', v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;
    v_result := jsonb_build_object('sessionId', v_session_id);
  END IF;

  UPDATE public.idempotency_records
  SET result = v_result
  WHERE user_id = v_user AND key = p_key;

  RETURN jsonb_build_object('kind', 'applied', 'result', v_result);
END;
$$;

-- Grants ----------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.is_valid_measurement(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.decide_proposal(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_proposal_stale_if_pending(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_workout_mutation(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_valid_measurement(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decide_proposal(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_proposal_stale_if_pending(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_workout_mutation(uuid, jsonb) TO authenticated;
