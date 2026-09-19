-- The trusted boundary, stated once (ADR-0012, second review of cc91a55..3add3de).
--
-- Three cycles of fixes each closed the hole that was found and left the same shape elsewhere:
-- something the server must know, taken from the caller. ADR-0012 writes the invariants down as
-- a matrix, and this migration is that matrix as it exists in the database. What changes here:
--
--   I-2   `REVOKE ALL PRIVILEGES` rather than a list. Revoking INSERT, UPDATE, DELETE, TRUNCATE
--         and REFERENCES by name left TRIGGER and (Postgres 17) MAINTAIN behind, which the
--         deployed schema confirmed: `GRANT SELECT,TRIGGER,MAINTAIN ... TO authenticated` on all
--         six tables. TRIGGER on a table one can read is enough to attach a function to it.
--   I-4   Owner and `search_path` are stated in the source rather than inherited from whoever
--         ran the migration, and the helpers are executable by nobody at all: they are called
--         inside definer functions, so `authenticated` never needs them.
--   I-8   A rejection is its own function and reads no plan. `decide_proposal` locked the active
--         plan before it looked at the decision, so a status-only rejection - normative in the
--         agent-proposals specification, and the reason `rejectIfPending` exists - failed for a
--         user whose plan was not readable.
--   I-5/6 The compare-and-set the port mandates is carried end to end: the caller states the
--         status and revision it decided against, the server compares both with rows it locks,
--         and a mismatch reports the server's value. An expectation can only lose; it never
--         becomes the answer.
--   I-11/12/13 Validation checks JSON types instead of coercing to text. `->>` turns a missing
--         field into NULL, and `NULL !~ '...'` is NULL, which `IF` treats as false - so a
--         mutation missing `planRevision` passed validation and failed later on a NOT NULL
--         constraint, `"repetitions": "8"` passed as a number, and a cardio result with no
--         `duration` passed with no duration at all.
--   I-14  A session's plan-derived facts come from the plan: the revision, the prescribed
--         exercises and the combined-load permission are read from the locked plan's scheduled
--         session, exactly as `startSession` derives them. A payload may carry them, and they
--         must agree.
--   I-15/17/18/20 A set must name an exercise the session prescribes, cannot predate the
--         session, and takes its sequence from how many sets the session already has; a session
--         cannot complete before it started. Each is an invariant `packages/domain/src/session.ts`
--         already enforces for the device, now also true of anything that reaches the database.
--
-- Additive: the functions are replaced and `decide_proposal` is dropped, no applied migration is
-- edited, and no table is rewritten.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- I-2: privileges ------------------------------------------------------------------------------

REVOKE ALL PRIVILEGES
  ON public.plans, public.workout_sessions, public.recorded_sets,
     public.session_corrections, public.proposals, public.idempotency_records
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.plans TO authenticated;
GRANT SELECT ON public.workout_sessions TO authenticated;
GRANT SELECT ON public.recorded_sets TO authenticated;
GRANT SELECT ON public.session_corrections TO authenticated;
GRANT SELECT ON public.proposals TO authenticated;
GRANT SELECT ON public.idempotency_records TO authenticated;

-- I-11/12/13: JSON validation that checks types ------------------------------------------------

-- `->>` reads a field as text, which makes a missing field indistinguishable from an absent one
-- and a string indistinguishable from a number. These read the JSON type first.

CREATE OR REPLACE FUNCTION public.json_is_positive_integer(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT p IS NOT NULL
     AND jsonb_typeof(p) = 'number'
     AND (p #>> '{}')::numeric >= 1
     AND (p #>> '{}')::numeric = trunc((p #>> '{}')::numeric);
$$;

CREATE OR REPLACE FUNCTION public.json_is_nonnegative_number(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT p IS NOT NULL
     AND jsonb_typeof(p) = 'number'
     AND (p #>> '{}')::numeric >= 0;
$$;

CREATE OR REPLACE FUNCTION public.json_is_nonempty_string(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND length(p #>> '{}') > 0;
$$;

/*
 * A quantity as the domain models it: a unit that is exactly the expected one and a finite,
 * non-negative number. JSON has no infinity, so "is a number" is enough for finiteness.
 */
CREATE OR REPLACE FUNCTION public.json_is_quantity(p jsonb, p_unit text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT p IS NOT NULL
     AND jsonb_typeof(p) = 'object'
     AND jsonb_typeof(p -> 'unit') = 'string'
     AND p ->> 'unit' = p_unit
     AND public.json_is_nonnegative_number(p -> 'value');
$$;

/*
 * An ISO 8601 instant with an explicit zone, which is what `Date#toISOString` produces. Returns
 * NULL for anything else, so a caller cannot smuggle a bare date or a local time whose meaning
 * depends on the server's zone. STABLE rather than IMMUTABLE because the cast reads settings.
 */
CREATE OR REPLACE FUNCTION public.json_timestamptz(p jsonb)
  RETURNS timestamptz
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'pg_catalog'
AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'string' THEN
    RETURN NULL;
  END IF;
  IF (p #>> '{}') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
    RETURN NULL;
  END IF;
  RETURN (p #>> '{}')::timestamptz;
END;
$$;

/*
 * I-13: the same check as `isMeasurement` in packages/domain/src/session.ts, field for field.
 *
 * Duplicated deliberately (ADR-0012): the domain's copy refuses a bad measurement on a device
 * that is offline, and this one is the copy that is authoritative.
 */
CREATE OR REPLACE FUNCTION public.is_valid_measurement(p_measurement jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_profile text;
BEGIN
  IF p_measurement IS NULL OR jsonb_typeof(p_measurement) <> 'object' THEN
    RETURN false;
  END IF;
  -- The schema version is a number, and only the current one (D-014).
  IF p_measurement -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_measurement -> 'profile') <> 'string' THEN
    RETURN false;
  END IF;
  v_profile := p_measurement ->> 'profile';

  IF v_profile = 'strength' THEN
    RETURN public.json_is_positive_integer(p_measurement -> 'repetitions')
       AND (NOT p_measurement ? 'load' OR public.json_is_quantity(p_measurement -> 'load', 'kg'));
  END IF;

  IF v_profile = 'unilateral_strength' THEN
    RETURN public.json_is_positive_integer(p_measurement -> 'repetitions')
       AND (NOT p_measurement ? 'load' OR public.json_is_quantity(p_measurement -> 'load', 'kg'))
       AND jsonb_typeof(p_measurement -> 'side') = 'string'
       AND (p_measurement ->> 'side') IN ('left', 'right', 'both', 'alternating')
       AND jsonb_typeof(p_measurement -> 'loadSemantics') = 'string'
       AND (p_measurement ->> 'loadSemantics') IN ('per_side', 'total');
  END IF;

  IF v_profile = 'cardio' THEN
    RETURN public.json_is_quantity(p_measurement -> 'duration', 's')
       AND (NOT p_measurement ? 'distance'
            OR public.json_is_quantity(p_measurement -> 'distance', 'm'));
  END IF;

  RETURN false;
END;
$$;

-- I-5 to I-10: deciding a proposal -------------------------------------------------------------

DROP FUNCTION IF EXISTS public.decide_proposal(text, text);

/*
 * Accepting: the only decision that concerns the plan, so the only one that reads it.
 *
 * The caller states the status and the revision it decided against (the port's compare-and-set,
 * packages/application/src/ports.ts). Both are compared with rows this function locks, together
 * with the proposal's own stored base revision, and any mismatch reports what the server holds.
 */
CREATE OR REPLACE FUNCTION public.accept_proposal(
  p_proposal_id text,
  p_expected_status text,
  p_expected_revision bigint
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_status text;
  v_base_revision bigint;
  v_expires_at timestamptz;
  v_plan_revision bigint;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'a decision needs a signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_expected_status IS NULL
    OR p_expected_status NOT IN ('pending', 'accepted', 'rejected', 'rejected_stale', 'expired')
    OR p_proposal_id IS NULL
    OR p_expected_revision IS NULL
    OR p_expected_revision < 1
  THEN
    RAISE EXCEPTION 'an acceptance needs a proposal, a known expected status and a revision'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT status, base_revision, expires_at
  INTO v_status, v_base_revision, v_expires_at
  FROM public.proposals
  WHERE user_id = v_user AND id = p_proposal_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  -- I-5: pending, and the status the caller decided against.
  IF v_status <> 'pending' OR v_status <> p_expected_status THEN
    RETURN jsonb_build_object('kind', 'status_changed', 'currentStatus', v_status);
  END IF;

  -- I-9: past its lifetime is not reviewable at all, which the domain checks before staleness.
  IF v_expires_at IS NOT NULL AND v_expires_at <= v_now THEN
    UPDATE public.proposals
    SET status = 'expired', decided_at = v_now
    WHERE user_id = v_user AND id = p_proposal_id;
    RETURN jsonb_build_object('kind', 'expired');
  END IF;

  SELECT revision INTO v_plan_revision
  FROM public.plans
  WHERE user_id = v_user AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Nothing to apply it to. The proposal cannot be about a plan this user has.
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  -- I-6: the proposal's own base, and the caller's expectation, against the locked plan.
  IF v_base_revision IS DISTINCT FROM v_plan_revision
    OR p_expected_revision IS DISTINCT FROM v_plan_revision
  THEN
    RETURN jsonb_build_object('kind', 'revision_changed', 'currentRevision', v_plan_revision);
  END IF;

  UPDATE public.proposals
  SET status = 'accepted', decided_at = v_now
  WHERE user_id = v_user AND id = p_proposal_id;

  -- I-7: in this transaction, so two acceptances cannot share a base.
  UPDATE public.plans
  SET revision = revision + 1
  WHERE user_id = v_user AND status = 'active'
  RETURNING revision INTO v_plan_revision;

  RETURN jsonb_build_object('kind', 'committed', 'revision', v_plan_revision);
END;
$$;

/*
 * Rejecting: a decision about the proposal's content, so it never reads the plan (I-8).
 *
 * The status compare-and-set is kept - an already decided proposal is reported, never overwritten
 * - and there is no plan in this function at all, which is the point: a rejection has to work for
 * a user whose plan is missing, superseded, or unreadable.
 */
CREATE OR REPLACE FUNCTION public.reject_proposal(p_proposal_id text, p_expected_status text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_now timestamptz := now();
  v_status text;
  v_expires_at timestamptz;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'a decision needs a signed-in user' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_proposal_id IS NULL
    OR p_expected_status IS NULL
    OR p_expected_status NOT IN ('pending', 'accepted', 'rejected', 'rejected_stale', 'expired')
  THEN
    RAISE EXCEPTION 'a rejection needs a proposal and a known expected status'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT status, expires_at
  INTO v_status, v_expires_at
  FROM public.proposals
  WHERE user_id = v_user AND id = p_proposal_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('kind', 'not_found');
  END IF;

  IF v_status <> 'pending' OR v_status <> p_expected_status THEN
    RETURN jsonb_build_object('kind', 'status_changed', 'currentStatus', v_status);
  END IF;

  IF v_expires_at IS NOT NULL AND v_expires_at <= v_now THEN
    -- The domain refuses to reject an expired proposal: expiry is reported instead of a
    -- decision nobody could still make (packages/domain/src/proposal.ts).
    UPDATE public.proposals
    SET status = 'expired', decided_at = v_now
    WHERE user_id = v_user AND id = p_proposal_id;
    RETURN jsonb_build_object('kind', 'expired');
  END IF;

  UPDATE public.proposals
  SET status = 'rejected', decided_at = v_now
  WHERE user_id = v_user AND id = p_proposal_id;

  -- No revision: this decision did not concern the plan, and reporting one would invite a
  -- caller to believe it did.
  RETURN jsonb_build_object('kind', 'committed');
END;
$$;

/*
 * Marking stale: status-only, like a rejection, and for the same reason (I-8).
 */
CREATE OR REPLACE FUNCTION public.mark_proposal_stale_if_pending(p_proposal_id text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_status text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'a transition needs a signed-in user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_proposal_id IS NULL THEN
    RAISE EXCEPTION 'a transition needs a proposal' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT status INTO v_status
  FROM public.proposals
  WHERE user_id = v_user AND id = p_proposal_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_status <> 'pending' THEN
    RETURN 'not_pending';
  END IF;

  UPDATE public.proposals
  SET status = 'rejected_stale', decided_at = now()
  WHERE user_id = v_user AND id = p_proposal_id;

  RETURN 'marked';
END;
$$;

-- I-12 to I-22: applying a delivered mutation --------------------------------------------------

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
  IF jsonb_typeof(p_mutation -> 'kind') <> 'string' THEN
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
      OR NOT public.is_valid_measurement(v_set -> 'measurement')
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

-- I-4: owner, and who may execute --------------------------------------------------------------

-- Stated rather than inherited. A function owned by anything but `postgres` would run as that
-- role instead, and `search_path` is pinned in each definition above.
ALTER FUNCTION public.json_is_positive_integer(jsonb) OWNER TO postgres;
ALTER FUNCTION public.json_is_nonnegative_number(jsonb) OWNER TO postgres;
ALTER FUNCTION public.json_is_nonempty_string(jsonb) OWNER TO postgres;
ALTER FUNCTION public.json_is_quantity(jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.json_timestamptz(jsonb) OWNER TO postgres;
ALTER FUNCTION public.is_valid_measurement(jsonb) OWNER TO postgres;
ALTER FUNCTION public.accept_proposal(text, text, bigint) OWNER TO postgres;
ALTER FUNCTION public.reject_proposal(text, text) OWNER TO postgres;
ALTER FUNCTION public.mark_proposal_stale_if_pending(text) OWNER TO postgres;
ALTER FUNCTION public.apply_workout_mutation(uuid, jsonb) OWNER TO postgres;

-- The helpers are called inside the definer functions, which run as their owner, so no client
-- role needs them. Default privileges in `public` grant EXECUTE to anon and authenticated, so
-- they are revoked rather than merely not granted.
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_positive_integer(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_nonnegative_number(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_nonempty_string(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_quantity(jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_timestamptz(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_measurement(jsonb)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL PRIVILEGES ON FUNCTION public.accept_proposal(text, text, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.reject_proposal(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.mark_proposal_stale_if_pending(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.apply_workout_mutation(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.accept_proposal(text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_proposal(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_proposal_stale_if_pending(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_workout_mutation(uuid, jsonb) TO authenticated;
