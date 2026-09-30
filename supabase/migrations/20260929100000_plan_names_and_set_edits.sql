-- Plan-carried rest, names, and editing or deleting a recorded set (spec revision 2, VLA-22).
--
-- Additive only: three columns on `workout_sessions`, two on `recorded_sets`, one on `plans`,
-- and `apply_workout_mutation` replaced. No applied migration is edited and nothing is dropped.
--
--   * `plans.name`: what the lifter calls the plan. Sessions and exercises are named inside the
--     `sessions` document, next to the rest an exercise carries, so neither needs a column.
--   * `workout_sessions.name`, `exercise_names`: the plan's names, snapshotted when the session
--     starts and derived from the locked plan row (I-14, I-28), so a rename mid-workout cannot
--     change what the screen calls a set already recorded.
--   * `recorded_sets.edited_at`, `deleted_at`: an edit changes the result in place; a delete is a
--     tombstone. The row is kept so that a delete which is queued, replayed or undone is one
--     fact rather than a race between an insert and a removal (ADR-0003), and so `sequence`
--     stays unique when a later set is recorded after a delete.
--   * three mutation kinds, `edit_set`, `delete_set`, `restore_set`, each on the session in
--     progress only. A completed session's sets are immutable (I-19), which is what makes a
--     delete final once the workout is finished.
--
-- A name is 1 to 60 characters and not only whitespace, counted in characters here and in UTF-16
-- units in the domain and contracts; the database is the looser of the two for astral characters,
-- never the stricter.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.plans
  ADD CONSTRAINT plans_name_bounded
  CHECK (name IS NULL OR (char_length(name) <= 60 AND btrim(name) <> ''));

ALTER TABLE public.workout_sessions
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS exercise_names jsonb;
ALTER TABLE public.workout_sessions
  ADD CONSTRAINT workout_sessions_name_bounded
  CHECK (name IS NULL OR (char_length(name) <= 60 AND btrim(name) <> '')),
  ADD CONSTRAINT workout_sessions_exercise_names_object
  CHECK (exercise_names IS NULL OR jsonb_typeof(exercise_names) = 'object');

ALTER TABLE public.recorded_sets
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.recorded_sets
  ADD CONSTRAINT recorded_sets_edited_after_recorded
  CHECK (edited_at IS NULL OR edited_at >= recorded_at),
  ADD CONSTRAINT recorded_sets_deleted_after_recorded
  CHECK (deleted_at IS NULL OR deleted_at >= recorded_at);

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
  v_session_name text;
  v_exercise_names jsonb;
  v_set_id text;
  v_changed_at timestamptz;
  v_set_exercise text;
  v_set_measurement jsonb;
  v_set_recorded_at timestamptz;
  v_set_deleted_at timestamptz;
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
  IF v_kind NOT IN (
    'start_session', 'record_set', 'complete_session', 'edit_set', 'delete_set', 'restore_set'
  ) THEN
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

    -- I-28: the names a lifter sees are the plan's, snapshotted with the session so a rename
    -- mid-workout cannot change what the screen calls a set that was already recorded. Only a
    -- string counts as a name; anything else is treated as no name at all.
    v_session_name := CASE
      WHEN jsonb_typeof(v_scheduled -> 'name') IS NOT DISTINCT FROM 'string'
        THEN v_scheduled ->> 'name'
    END;
    v_exercise_names := COALESCE(
      (
        SELECT jsonb_object_agg(exercise ->> 'exerciseId', exercise -> 'name')
        FROM jsonb_array_elements(COALESCE(v_scheduled -> 'exercises', '[]'::jsonb)) AS exercise
        WHERE jsonb_typeof(exercise -> 'name') IS NOT DISTINCT FROM 'string'
      ),
      '{}'::jsonb
    );

    -- A payload may carry what it snapshotted. It must agree with the plan, so an old client is
    -- refused rather than silently corrected.
    IF (v_session ? 'planRevision'
          AND v_session -> 'planRevision' IS DISTINCT FROM to_jsonb(v_plan_revision))
      OR (v_session ? 'exerciseIds'
          AND v_session -> 'exerciseIds' IS DISTINCT FROM to_jsonb(v_exercise_ids))
      OR (v_session ? 'combinedLoadExercises'
          AND v_session -> 'combinedLoadExercises' IS DISTINCT FROM to_jsonb(v_combined))
      OR (v_session ? 'name'
          AND v_session -> 'name' IS DISTINCT FROM to_jsonb(v_session_name))
      OR (v_session ? 'exerciseNames'
          AND v_session -> 'exerciseNames' IS DISTINCT FROM v_exercise_names)
    THEN
      RAISE EXCEPTION 'the session disagrees with the plan it names'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    INSERT INTO public.workout_sessions (
      user_id, id, plan_id, plan_revision, scheduled_session_id,
      exercise_ids, combined_load_exercises, started_at, status, name, exercise_names
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
      'active',
      v_session_name,
      v_exercise_names
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

  ELSIF v_kind = 'complete_session' THEN
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

  ELSE
    -- edit_set, delete_set, restore_set: a change to one set of the session in progress.
    v_session_id := CASE
      WHEN public.json_is_nonempty_string(p_mutation -> 'sessionId')
        THEN p_mutation ->> 'sessionId'
    END;
    v_set_id := CASE
      WHEN public.json_is_nonempty_string(p_mutation -> 'setId')
        THEN p_mutation ->> 'setId'
    END;
    IF v_session_id IS NULL OR v_set_id IS NULL THEN
      RAISE EXCEPTION 'malformed %', v_kind USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_kind = 'edit_set' THEN
      v_changed_at := public.json_timestamptz(p_mutation -> 'editedAt');
      IF v_changed_at IS NULL
        OR public.is_valid_measurement(p_mutation -> 'measurement') IS NOT TRUE
      THEN
        RAISE EXCEPTION 'malformed edit_set' USING ERRCODE = 'invalid_parameter_value';
      END IF;
    ELSIF v_kind = 'delete_set' THEN
      v_changed_at := public.json_timestamptz(p_mutation -> 'deletedAt');
      IF v_changed_at IS NULL THEN
        RAISE EXCEPTION 'malformed delete_set' USING ERRCODE = 'invalid_parameter_value';
      END IF;
    END IF;

    -- The session row is locked first, so a change and a concurrent record_set or completion
    -- are applied one after the other rather than against a stale count or status.
    SELECT status, combined_load_exercises INTO v_session_status, v_combined
    FROM public.workout_sessions
    WHERE user_id = v_user AND id = v_session_id
    FOR UPDATE;

    -- I-19: a completed session's facts are immutable, which is also what makes a delete final
    -- once the workout is finished.
    IF NOT FOUND OR v_session_status <> 'active' THEN
      RAISE EXCEPTION 'no active session % to change a set in', v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;

    SELECT exercise_id, measurement, recorded_at, deleted_at
    INTO v_set_exercise, v_set_measurement, v_set_recorded_at, v_set_deleted_at
    FROM public.recorded_sets
    WHERE user_id = v_user AND session_id = v_session_id AND set_id = v_set_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no set % in session %', v_set_id, v_session_id
        USING ERRCODE = 'no_data_found';
    END IF;

    IF v_kind = 'restore_set' THEN
      -- I-27: a restore compensates a delete, so it needs one to compensate.
      IF v_set_deleted_at IS NULL THEN
        RAISE EXCEPTION 'set % is not deleted', v_set_id USING ERRCODE = 'invalid_parameter_value';
      END IF;
      UPDATE public.recorded_sets
      SET deleted_at = NULL
      WHERE user_id = v_user AND set_id = v_set_id;
    ELSE
      IF v_set_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'set % is deleted', v_set_id USING ERRCODE = 'invalid_parameter_value';
      END IF;
      -- I-29: a change cannot predate the set it changes.
      IF v_changed_at < v_set_recorded_at THEN
        RAISE EXCEPTION 'the change predates the set it changes'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      IF v_kind = 'delete_set' THEN
        -- I-27: a tombstone, never a removal. The row keeps its sequence, so a later record_set
        -- still counts past it and a restore puts it back where it was.
        UPDATE public.recorded_sets
        SET deleted_at = v_changed_at
        WHERE user_id = v_user AND set_id = v_set_id;
      ELSE
        -- I-26: what the set is stays. Only its result moves, and the result is held to the same
        -- rules as when it was recorded: the whole measurement contract (I-13), the same
        -- profile, and combined load only where the plan permitted it (I-16).
        IF (v_set_measurement ->> 'profile')
          IS DISTINCT FROM (p_mutation -> 'measurement' ->> 'profile')
        THEN
          RAISE EXCEPTION 'an edit cannot change the kind of result'
            USING ERRCODE = 'invalid_parameter_value';
        END IF;
        IF (p_mutation -> 'measurement' ->> 'profile') = 'unilateral_strength'
          AND (p_mutation -> 'measurement' ->> 'loadSemantics') = 'total'
          AND NOT (v_set_exercise = ANY (v_combined))
        THEN
          RAISE EXCEPTION 'combined load is not permitted for %', v_set_exercise
            USING ERRCODE = 'invalid_parameter_value';
        END IF;
        UPDATE public.recorded_sets
        SET measurement = p_mutation -> 'measurement',
            edited_at = v_changed_at
        WHERE user_id = v_user AND set_id = v_set_id;
      END IF;
    END IF;
    v_result := jsonb_build_object('setId', v_set_id);
  END IF;

  UPDATE public.idempotency_records
  SET result = v_result
  WHERE user_id = v_user AND key = p_key;

  RETURN jsonb_build_object('kind', 'applied', 'result', v_result);
END;
$$;

ALTER FUNCTION public.apply_workout_mutation(uuid, jsonb) OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.apply_workout_mutation(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_workout_mutation(uuid, jsonb) TO authenticated;
