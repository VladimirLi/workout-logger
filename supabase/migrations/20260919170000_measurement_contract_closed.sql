-- The whole measurement contract, at the boundary that stores it (ADR-0012, I-13).
--
-- `packages/contracts/src/measurement.ts` is the authoritative contract and has always been
-- closed: strict objects, a maximum per unit, notes bounded at 2000 characters, a typed exertion
-- whose derived RPE must follow from the stored RIR, and an incline between -20 and 40. The
-- database validated a subset of it and then stored the JSON verbatim, so every field it did not
-- check reached `recorded_sets` unvalidated - a load of 1001 kg, an RIR of 11, a Borg rating of
-- 12.5, an RPE that contradicts its own RIR, or a field nobody defines riding along beside them.
--
-- The domain's runtime check had the same gap and is closed in the same change
-- (packages/domain/src/session.ts), so the three copies of this contract now agree field for
-- field. ADR-0012 accepts that duplication deliberately: the wire copy refuses a payload before
-- it is queued, the domain copy refuses one on a device that is offline, and this copy is the
-- one that is authoritative.
--
-- Every predicate is total, which is the lesson of 20260919150000: a NULL that reads as neither
-- true nor false is how the previous validator accepted a unilateral measurement with no load
-- semantics. Each helper returns a value for every input, and each chain is closed with COALESCE.
--
-- Additive: one function is replaced and three are added. No applied migration is edited.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

/** Only the keys the contract defines, so a field nobody understands cannot ride along (R-021). */
CREATE OR REPLACE FUNCTION public.json_has_only(p jsonb, p_keys text[])
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT p IS NOT NULL
     AND jsonb_typeof(p) = 'object'
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_object_keys(p) AS key WHERE key <> ALL (p_keys)
     );
$$;

/**
 * A quantity of one dimension: the expected unit, a finite non-negative value within the bound
 * the domain's `quantity()` applies, and no other field.
 *
 * The maxima are the table in packages/domain/src/units.ts and
 * packages/contracts/src/primitives.ts. A value the constructor would refuse must not become
 * valid by arriving as JSON.
 */
CREATE OR REPLACE FUNCTION public.json_is_quantity(p jsonb, p_unit text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT COALESCE(
    public.json_has_only(p, ARRAY['unit', 'value'])
      AND jsonb_typeof(p -> 'unit') IS NOT DISTINCT FROM 'string'
      AND (p ->> 'unit') = p_unit
      AND public.json_is_nonnegative_number(p -> 'value')
      AND (p -> 'value' #>> '{}')::numeric <= CASE p_unit
        WHEN 'kg' THEN 1000
        WHEN 'm' THEN 1000000
        WHEN 's' THEN 86400
        WHEN 'kcal' THEN 100000
        WHEN 'W' THEN 5000
        WHEN 'rpm' THEN 300
        WHEN 'bpm' THEN 300
      END,
    false
  );
$$;

/** Notes: absent, or a string within the length the contract permits. */
CREATE OR REPLACE FUNCTION public.json_is_notes(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT p IS NULL
     OR COALESCE(jsonb_typeof(p) = 'string' AND length(p #>> '{}') <= 2000, false);
$$;

/**
 * A strength exertion, including the relationship between its two fields.
 *
 * RPE is derived from RIR and never entered (ADR-0004): `max(1, 10 - rir)`. Validating them
 * independently lets a record assert RIR 2 with RPE 1, which is two different efforts at once.
 * RIR is half-stepped, which `value * 2` being whole expresses.
 */
CREATE OR REPLACE FUNCTION public.json_is_strength_exertion(p jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_rir numeric;
  v_rpe numeric;
BEGIN
  IF p IS NULL THEN
    RETURN true;
  END IF;
  IF NOT public.json_has_only(p, ARRAY['profile', 'rir', 'rpe']) THEN
    RETURN false;
  END IF;
  IF (p ->> 'profile') IS DISTINCT FROM 'strength' THEN
    RETURN false;
  END IF;
  IF NOT public.json_has_only(p -> 'rir', ARRAY['kind', 'value'])
    OR (p -> 'rir' ->> 'kind') IS DISTINCT FROM 'rir'
    OR jsonb_typeof(p -> 'rir' -> 'value') IS DISTINCT FROM 'number'
  THEN
    RETURN false;
  END IF;
  IF NOT public.json_has_only(p -> 'rpe', ARRAY['kind', 'value'])
    OR (p -> 'rpe' ->> 'kind') IS DISTINCT FROM 'rpe_derived'
    OR jsonb_typeof(p -> 'rpe' -> 'value') IS DISTINCT FROM 'number'
  THEN
    RETURN false;
  END IF;

  v_rir := (p -> 'rir' -> 'value' #>> '{}')::numeric;
  v_rpe := (p -> 'rpe' -> 'value' #>> '{}')::numeric;
  IF v_rir < 0 OR v_rir > 10 OR (v_rir * 2) <> trunc(v_rir * 2) THEN
    RETURN false;
  END IF;
  RETURN v_rpe = greatest(1, 10 - v_rir);
END;
$$;

/** A cardio exertion: a whole Borg rating on the 6-20 scale, and nothing else. */
CREATE OR REPLACE FUNCTION public.json_is_cardio_exertion(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT p IS NULL
     OR COALESCE(
       public.json_has_only(p, ARRAY['profile', 'borg'])
         AND (p ->> 'profile') = 'cardio'
         AND jsonb_typeof(p -> 'borg') IS NOT DISTINCT FROM 'number'
         AND (p -> 'borg' #>> '{}')::numeric >= 6
         AND (p -> 'borg' #>> '{}')::numeric <= 20
         AND (p -> 'borg' #>> '{}')::numeric = trunc((p -> 'borg' #>> '{}')::numeric),
       false
     );
$$;

/** An incline: absent, or a number in the range the contract permits. */
CREATE OR REPLACE FUNCTION public.json_is_incline(p jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
AS $$
  SELECT p IS NULL
     OR COALESCE(
       jsonb_typeof(p) = 'number'
         AND (p #>> '{}')::numeric >= -20
         AND (p #>> '{}')::numeric <= 40,
       false
     );
$$;

/**
 * The measurement contract, closed: the same fields, bounds and key sets as
 * packages/contracts/src/measurement.ts and `isMeasurement` in packages/domain/src/session.ts.
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
  IF p_measurement IS NULL OR jsonb_typeof(p_measurement) IS DISTINCT FROM 'object' THEN
    RETURN false;
  END IF;
  IF p_measurement -> 'schemaVersion' IS DISTINCT FROM '1'::jsonb THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(p_measurement -> 'profile') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  IF NOT public.json_is_notes(p_measurement -> 'notes') THEN
    RETURN false;
  END IF;
  v_profile := p_measurement ->> 'profile';

  IF v_profile = 'strength' THEN
    RETURN COALESCE(
      public.json_has_only(
        p_measurement,
        ARRAY['schemaVersion', 'profile', 'repetitions', 'load', 'exertion', 'notes']
      )
        AND public.json_is_positive_integer(p_measurement -> 'repetitions')
        AND (NOT p_measurement ? 'load'
             OR public.json_is_quantity(p_measurement -> 'load', 'kg'))
        AND public.json_is_strength_exertion(p_measurement -> 'exertion'),
      false
    );
  END IF;

  IF v_profile = 'unilateral_strength' THEN
    RETURN COALESCE(
      public.json_has_only(
        p_measurement,
        ARRAY[
          'schemaVersion', 'profile', 'side', 'loadSemantics', 'repetitions', 'load',
          'exertion', 'notes'
        ]
      )
        AND public.json_is_positive_integer(p_measurement -> 'repetitions')
        AND (NOT p_measurement ? 'load'
             OR public.json_is_quantity(p_measurement -> 'load', 'kg'))
        AND jsonb_typeof(p_measurement -> 'side') IS NOT DISTINCT FROM 'string'
        AND (p_measurement ->> 'side') IN ('left', 'right', 'both', 'alternating')
        AND jsonb_typeof(p_measurement -> 'loadSemantics') IS NOT DISTINCT FROM 'string'
        AND (p_measurement ->> 'loadSemantics') IN ('per_side', 'total')
        AND public.json_is_strength_exertion(p_measurement -> 'exertion'),
      false
    );
  END IF;

  IF v_profile = 'cardio' THEN
    RETURN COALESCE(
      public.json_has_only(
        p_measurement,
        ARRAY[
          'schemaVersion', 'profile', 'duration', 'distance', 'inclinePercent', 'exertion', 'notes'
        ]
      )
        AND public.json_is_quantity(p_measurement -> 'duration', 's')
        AND (NOT p_measurement ? 'distance'
             OR public.json_is_quantity(p_measurement -> 'distance', 'm'))
        AND public.json_is_incline(p_measurement -> 'inclinePercent')
        AND public.json_is_cardio_exertion(p_measurement -> 'exertion'),
      false
    );
  END IF;

  RETURN false;
END;
$$;

-- I-4: stated, not inherited, and callable by no client role.
ALTER FUNCTION public.json_has_only(jsonb, text[]) OWNER TO postgres;
ALTER FUNCTION public.json_is_quantity(jsonb, text) OWNER TO postgres;
ALTER FUNCTION public.json_is_notes(jsonb) OWNER TO postgres;
ALTER FUNCTION public.json_is_strength_exertion(jsonb) OWNER TO postgres;
ALTER FUNCTION public.json_is_cardio_exertion(jsonb) OWNER TO postgres;
ALTER FUNCTION public.json_is_incline(jsonb) OWNER TO postgres;
ALTER FUNCTION public.is_valid_measurement(jsonb) OWNER TO postgres;

REVOKE ALL PRIVILEGES ON FUNCTION public.json_has_only(jsonb, text[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_quantity(jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_notes(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_strength_exertion(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_cardio_exertion(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.json_is_incline(jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON FUNCTION public.is_valid_measurement(jsonb)
  FROM PUBLIC, anon, authenticated;
