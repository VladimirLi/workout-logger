-- Idempotent replay on the server (first-vertical-slice, tasks 2.6 and 4.3; offline-sync spec).
--
-- One function, so the idempotency record and the mutation it describes commit together. That
-- is the whole requirement: if they were two statements from the client, a process that died
-- between them would leave a key recorded for a mutation that never happened, or a mutation
-- that a retry would apply twice.
--
--   first delivery   the record is written and the mutation applied, in one transaction
--   replay, same     nothing is applied and the original result is returned
--   replay, changed  refused, because the key already means something else
--
-- The fingerprint is a digest of the mutation the client computed. Comparing it is what makes
-- "a key reused with a different payload is refused" checkable without storing the payload
-- twice.
--
-- SECURITY INVOKER with a pinned search_path, and executable by authenticated only, like the
-- proposal functions.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.apply_workout_mutation(
  p_user_id uuid,
  p_key uuid,
  p_fingerprint text,
  p_mutation jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_existing public.idempotency_records%ROWTYPE;
  v_kind text;
  v_session jsonb;
  v_session_id text;
  v_set jsonb;
  v_result jsonb;
BEGIN
  -- Claim the key first. A concurrent delivery of the same key blocks here and then finds the
  -- record, which is what makes "exactly once" true under a retry storm rather than only under
  -- a polite client.
  INSERT INTO public.idempotency_records (user_id, key, request_fingerprint, result)
  VALUES (p_user_id, p_key, p_fingerprint, '{}'::jsonb)
  ON CONFLICT (user_id, key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM public.idempotency_records
    WHERE user_id = p_user_id AND key = p_key
    FOR UPDATE;

    IF v_existing.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
      -- The same key for a different change. Refused rather than applied: one of the two
      -- would otherwise be silently lost, and the client cannot tell which.
      RETURN jsonb_build_object('kind', 'key_reused');
    END IF;

    RETURN jsonb_build_object('kind', 'replayed', 'result', v_existing.result);
  END IF;

  v_kind := p_mutation ->> 'kind';

  IF v_kind = 'start_session' THEN
    v_session := p_mutation -> 'session';
    INSERT INTO public.workout_sessions (
      user_id, id, plan_id, plan_revision, scheduled_session_id,
      exercise_ids, combined_load_exercises, started_at, status
    )
    VALUES (
      p_user_id,
      v_session ->> 'id',
      v_session ->> 'planId',
      (v_session ->> 'planRevision')::bigint,
      v_session ->> 'scheduledSessionId',
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(v_session -> 'exerciseIds')),
        ARRAY[]::text[]
      ),
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
    INSERT INTO public.recorded_sets (
      user_id, set_id, session_id, sequence, exercise_id, measurement, recorded_at
    )
    VALUES (
      p_user_id,
      v_set ->> 'setId',
      v_session_id,
      (v_set ->> 'sequence')::integer,
      v_set ->> 'exerciseId',
      v_set -> 'measurement',
      (v_set ->> 'recordedAt')::timestamptz
    );
    v_result := jsonb_build_object('setId', v_set ->> 'setId');

  ELSIF v_kind = 'complete_session' THEN
    v_session_id := p_mutation ->> 'sessionId';
    UPDATE public.workout_sessions
    SET status = 'completed',
        completed_at = (p_mutation ->> 'completedAt')::timestamptz,
        synchronized_at = now(),
        -- The first revision of the session's facts. A correction advances it (D-012).
        facts_revision = 1
    WHERE user_id = p_user_id AND id = v_session_id AND status = 'active';

    IF NOT FOUND THEN
      -- Nothing to complete. Raising rolls back the claimed key with it, so the client may
      -- retry once the session it names exists.
      RAISE EXCEPTION 'no active session % to complete', v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;
    v_result := jsonb_build_object('sessionId', v_session_id);

  ELSE
    RAISE EXCEPTION 'unknown mutation kind %', COALESCE(v_kind, 'null')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.idempotency_records
  SET result = v_result
  WHERE user_id = p_user_id AND key = p_key;

  RETURN jsonb_build_object('kind', 'applied', 'result', v_result);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_workout_mutation(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_workout_mutation(uuid, uuid, text, jsonb) TO authenticated;
