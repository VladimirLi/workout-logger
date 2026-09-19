-- Validation that is total: no condition may be neither true nor false.
--
-- The invariant migration (20260919140000) was caught by its own suite. A unilateral measurement
-- with no `loadSemantics` was accepted, because `jsonb_typeof(NULL) = 'string'` is NULL, the AND
-- chain returned NULL rather than false, and `NOT NULL` is NULL, which `IF` treats as false. The
-- same three-valued trap sat on the mutation kind: a payload with no `kind` passed the type check
-- and fell through to the `complete_session` branch.
--
-- This is the shape the previous validation failed at too - `->>` making a missing field
-- indistinguishable from a present one - reappearing as NULL propagation rather than as text
-- coercion. The fix is the same principle: a predicate about untrusted input must answer true or
-- false, never neither. Every branch below returns a value, `COALESCE` closes the chains, and the
-- one caller uses `IS NOT TRUE` so a NULL can never read as "valid".

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.is_valid_measurement(p_measurement jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_profile text;
BEGIN
  IF p_measurement IS NULL OR jsonb_typeof(p_measurement) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF p_measurement -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_measurement -> 'profile') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  v_profile := p_measurement ->> 'profile';

  IF v_profile = 'strength' THEN
    RETURN COALESCE(
      public.json_is_positive_integer(p_measurement -> 'repetitions')
        AND (NOT p_measurement ? 'load'
             OR public.json_is_quantity(p_measurement -> 'load', 'kg')),
      false
    );
  END IF;

  IF v_profile = 'unilateral_strength' THEN
    RETURN COALESCE(
      public.json_is_positive_integer(p_measurement -> 'repetitions')
        AND (NOT p_measurement ? 'load'
             OR public.json_is_quantity(p_measurement -> 'load', 'kg'))
        AND jsonb_typeof(p_measurement -> 'side') IS NOT DISTINCT FROM 'string'
        AND (p_measurement ->> 'side') IN ('left', 'right', 'both', 'alternating')
        AND jsonb_typeof(p_measurement -> 'loadSemantics') IS NOT DISTINCT FROM 'string'
        AND (p_measurement ->> 'loadSemantics') IN ('per_side', 'total'),
      false
    );
  END IF;

  IF v_profile = 'cardio' THEN
    RETURN COALESCE(
      public.json_is_quantity(p_measurement -> 'duration', 's')
        AND (NOT p_measurement ? 'distance'
             OR public.json_is_quantity(p_measurement -> 'distance', 'm')),
      false
    );
  END IF;

  RETURN false;
END;
$$;

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
  v_started_at timestamptz;
  v_recorded_at timestamptz;
  v_completed_at timestamptz;
  v_scheduled_id text;
  v_plan_revision bigint;
  v_plan_sessions jsonb;
  v_scheduled jsonb;
  v_exercise_ids text[];
  v_combined text[];
  v_session_status text;
  v_sequence integer;
  v_result jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'a delivery needs a signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_key IS NULL OR p_mutation IS NULL OR jsonb_typeof(p_mutation) <> 'object' THEN
    RAISE EXCEPTION 'a delivery needs a key and a mutation object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- I-12: a closed set of kinds, named by a string.
  -- `IS DISTINCT FROM`, not `<>`: a missing key makes `jsonb_typeof` NULL, `NULL <> 'string'`
  -- is NULL, and `IF` treats NULL as false - so the check passed and the kind stayed NULL.
  IF jsonb_typeof(p_mutation -> 'kind') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'a mutation needs a kind' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_kind := p_mutation ->> 'kind';
  IF v_kind NOT IN ('start_session', 'record_set', 'complete_session') THEN
    RAISE EXCEPTION 'unknown mutation kind %', v_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- I-21/22: claim the key before anything is applied. A concurrent delivery of the same key
  -- waits here and then finds the record, which is what makes exactly-once true under a retry
  -- storm rather than a polite client.
  INSERT INTO public.idempotency_records (user_id, key, request_fingerprint, mutation, result)
  VALUES (v_user, p_key, md5(p_mutation::text), p_mutation, '{}'::jsonb)
  ON CONFLICT (user_id, key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.idempotency_records
    WHERE user_id = v_user AND key = p_key
    FOR UPDATE;

    -- The stored payload itself, not a digest the caller chose.
    IF v_existing.mutation IS DISTINCT FROM p_mutation THEN
      RETURN jsonb_build_object('kind', 'key_reused');
    END IF;
    RETURN jsonb_build_object('kind', 'replayed', 'result', v_existing.result);
  END IF;

  IF v_kind = 'start_session' THEN
    v_session := p_mutation -> 'session';
    IF v_session IS NULL OR jsonb_typeof(v_session) <> 'object' THEN
      RAISE EXCEPTION 'a start_session needs a session' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_started_at := public.json_timestamptz(v_session -> 'startedAt');
    v_scheduled_id := CASE
      WHEN public.json_is_nonempty_string(v_session -> 'scheduledSessionId')
        THEN v_session ->> 'scheduledSessionId'
    END;
    IF NOT public.json_is_nonempty_string(v_session -> 'id')
      OR NOT public.json_is_nonempty_string(v_session -> 'planId')
      OR v_scheduled_id IS NULL
      OR v_started_at IS NULL
    THEN
      RAISE EXCEPTION 'malformed start_session' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- I-14: the plan's facts, from the plan. Locked, so a plan accepted concurrently cannot
    -- leave the snapshot half from one revision and half from the next.
    SELECT revision, sessions INTO v_plan_revision, v_plan_sessions
    FROM public.plans
    WHERE user_id = v_user AND id = v_session ->> 'planId' AND status = 'active'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no active plan % for this user', v_session ->> 'planId'
        USING ERRCODE = 'foreign_key_violation';
    END IF;

    SELECT element INTO v_scheduled
    FROM jsonb_array_elements(COALESCE(v_plan_sessions, '[]'::jsonb)) AS element
    WHERE element ->> 'id' = v_scheduled_id
    LIMIT 1;
    IF v_scheduled IS NULL THEN
      RAISE EXCEPTION 'the active plan has no scheduled session %', v_scheduled_id
        USING ERRCODE = 'no_data_found';
    END IF;

    v_exercise_ids := COALESCE(
      ARRAY(
        SELECT exercise ->> 'exerciseId'
        FROM jsonb_array_elements(COALESCE(v_scheduled -> 'exercises', '[]'::jsonb)) AS exercise
      ),
      ARRAY[]::text[]
    );
    v_combined := COALESCE(
      ARRAY(
        SELECT exercise ->> 'exerciseId'
        FROM jsonb_array_elements(COALESCE(v_scheduled -> 'exercises', '[]'::jsonb)) AS exercise
        WHERE exercise -> 'combinedLoadPermitted' = 'true'::jsonb
      ),
      ARRAY[]::text[]
    );

    -- A payload may carry what it snapshotted. It must agree with the plan, so an old client is
    -- refused rather than silently corrected.
    IF (v_session ? 'planRevision'
          AND v_session -> 'planRevision' IS DISTINCT FROM to_jsonb(v_plan_revision))
      OR (v_session ? 'exerciseIds'
          AND v_session -> 'exerciseIds' IS DISTINCT FROM to_jsonb(v_exercise_ids))
      OR (v_session ? 'combinedLoadExercises'
          AND v_session -> 'combinedLoadExercises' IS DISTINCT FROM to_jsonb(v_combined))
    THEN
      RAISE EXCEPTION 'the session disagrees with the plan it names'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.workout_sessions (
      user_id, id, plan_id, plan_revision, scheduled_session_id,
      exercise_ids, combined_load_exercises, started_at, status
    )
    VALUES (
      v_user,
      v_session ->> 'id',
      v_session ->> 'planId',
      v_plan_revision,
      v_scheduled_id,
      v_exercise_ids,
      v_combined,
      v_started_at,
      'active'
    );
    v_result := jsonb_build_object('sessionId', v_session ->> 'id');

  ELSIF v_kind = 'record_set' THEN
    v_set := p_mutation -> 'set';
    v_session_id := CASE
      WHEN public.json_is_nonempty_string(p_mutation -> 'sessionId')
        THEN p_mutation ->> 'sessionId'
    END;
    IF v_set IS NULL OR jsonb_typeof(v_set) <> 'object' OR v_session_id IS NULL THEN
      RAISE EXCEPTION 'a record_set needs a session and a set'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_recorded_at := public.json_timestamptz(v_set -> 'recordedAt');
    IF NOT public.json_is_nonempty_string(v_set -> 'setId')
      OR NOT public.json_is_nonempty_string(v_set -> 'exerciseId')
      OR v_recorded_at IS NULL
      OR public.is_valid_measurement(v_set -> 'measurement') IS NOT TRUE
    THEN
      RAISE EXCEPTION 'malformed record_set' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT status, started_at, exercise_ids, combined_load_exercises
    INTO v_session_status, v_started_at, v_exercise_ids, v_combined
    FROM public.workout_sessions
    WHERE user_id = v_user AND id = v_session_id
    FOR UPDATE;

    -- I-19: a completed session's facts are immutable; a correction is an audited revision.
    IF NOT FOUND OR v_session_status <> 'active' THEN
      RAISE EXCEPTION 'no active session % to record into', v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- I-15: the session prescribes the exercise, or this set is about something else.
    IF NOT ((v_set ->> 'exerciseId') = ANY (v_exercise_ids)) THEN
      RAISE EXCEPTION 'the session does not prescribe %', v_set ->> 'exerciseId'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- I-17: nothing is recorded before the session started.
    IF v_recorded_at < v_started_at THEN
      RAISE EXCEPTION 'the set predates the session it belongs to'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- I-16: combined load is a claim about what the number means, permitted only where the plan
    -- said so (owner decision 2026-09-18).
    IF (v_set -> 'measurement' ->> 'profile') = 'unilateral_strength'
      AND (v_set -> 'measurement' ->> 'loadSemantics') = 'total'
      AND NOT ((v_set ->> 'exerciseId') = ANY (v_combined))
    THEN
      RAISE EXCEPTION 'combined load is not permitted for %', v_set ->> 'exerciseId'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- I-18: the order of recording, counted here rather than claimed by the caller.
    SELECT count(*) + 1 INTO v_sequence
    FROM public.recorded_sets
    WHERE user_id = v_user AND session_id = v_session_id;

    IF v_set ? 'sequence' AND v_set -> 'sequence' IS DISTINCT FROM to_jsonb(v_sequence) THEN
      RAISE EXCEPTION 'the set claims sequence % of session %', v_set ->> 'sequence', v_session_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.recorded_sets (
      user_id, set_id, session_id, sequence, exercise_id, measurement, recorded_at
    )
    VALUES (
      v_user,
      v_set ->> 'setId',
      v_session_id,
      v_sequence,
      v_set ->> 'exerciseId',
      v_set -> 'measurement',
      v_recorded_at
    );
    v_result := jsonb_build_object('setId', v_set ->> 'setId');

  ELSE
    v_session_id := CASE
      WHEN public.json_is_nonempty_string(p_mutation -> 'sessionId')
        THEN p_mutation ->> 'sessionId'
    END;
    v_completed_at := public.json_timestamptz(p_mutation -> 'completedAt');
    IF v_session_id IS NULL OR v_completed_at IS NULL THEN
      RAISE EXCEPTION 'malformed complete_session' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    SELECT status, started_at INTO v_session_status, v_started_at
    FROM public.workout_sessions
    WHERE user_id = v_user AND id = v_session_id
    FOR UPDATE;
    IF NOT FOUND OR v_session_status <> 'active' THEN
      RAISE EXCEPTION 'no active session % to complete', v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- I-20: a session cannot end before it began.
    IF v_completed_at < v_started_at THEN
      RAISE EXCEPTION 'the session would complete before it started'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    UPDATE public.workout_sessions
    SET status = 'completed',
        completed_at = v_completed_at,
        synchronized_at = now(),
        facts_revision = 1
    WHERE user_id = v_user AND id = v_session_id;

    v_result := jsonb_build_object('sessionId', v_session_id);
  END IF;

  UPDATE public.idempotency_records
  SET result = v_result
  WHERE user_id = v_user AND key = p_key;

  RETURN jsonb_build_object('kind', 'applied', 'result', v_result);
END;
$$;

ALTER FUNCTION public.is_valid_measurement(jsonb) OWNER TO postgres;
ALTER FUNCTION public.apply_workout_mutation(uuid, jsonb) OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_measurement(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.apply_workout_mutation(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_workout_mutation(uuid, jsonb) TO authenticated;
