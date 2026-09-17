-- Initial schema (first-vertical-slice, task 2.1; ADR-0005, R-016, R-017).
--
-- Every table here is reachable through the exposed schema, so every table enables row-level
-- security and grants nothing to anon. The predicate is always `user_id = auth.uid()`: this is
-- a single-user product per account, and a query that forgets the user must return nothing
-- rather than everything.
--
-- Typed measurements are stored as jsonb, validated by packages/contracts before they are
-- written. The alternative - a wide table of nullable columns for reps, load, duration and
-- distance - is the shape ADR-0004 exists to reject: it makes "a bench press set" and "twenty
-- minutes on a treadmill" the same row with different nulls, and nothing can tell an empty
-- field from an unmeasured one.
--
-- Not applied anywhere. No database is provisioned (docs/external-gates.md, G-2), so this has
-- been validated by `pnpm test:migrations` and never executed.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Plans -----------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.plans (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  id text NOT NULL,
  -- The value an agent proposal is computed against. Advances on every accepted change.
  revision bigint NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('active', 'superseded')),
  activated_at timestamptz NOT NULL,
  superseded_at timestamptz,
  -- The scheduled sessions and their typed prescriptions, as the domain holds them.
  sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (user_id, id),
  -- A superseded plan records when, and an active one cannot.
  CONSTRAINT plans_superseded_at_matches_status CHECK (
    (status = 'superseded') = (superseded_at IS NOT NULL)
  )
);

-- At most one active plan per user (workout-planning spec).
CREATE UNIQUE INDEX IF NOT EXISTS plans_one_active_per_user
  ON public.plans (user_id)
  WHERE status = 'active';

-- Workout sessions ------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.workout_sessions (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  id text NOT NULL,
  plan_id text NOT NULL,
  plan_revision bigint NOT NULL CHECK (plan_revision > 0),
  scheduled_session_id text NOT NULL,
  exercise_ids text[] NOT NULL DEFAULT '{}',
  started_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'completed')),
  completed_at timestamptz,
  -- Set when the server accepted the session; absent while it is still only on a device.
  synchronized_at timestamptz,
  -- Advances per correction to a completed session (D-012).
  facts_revision bigint CHECK (facts_revision > 0),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, plan_id) REFERENCES public.plans (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT workout_sessions_completed_fields CHECK (
    (status = 'completed') = (completed_at IS NOT NULL AND facts_revision IS NOT NULL)
  ),
  CONSTRAINT workout_sessions_completed_after_start CHECK (
    completed_at IS NULL OR completed_at >= started_at
  )
);

-- One active session per device and per user (workout-logging spec).
CREATE UNIQUE INDEX IF NOT EXISTS workout_sessions_one_active_per_user
  ON public.workout_sessions (user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.recorded_sets (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  set_id text NOT NULL,
  session_id text NOT NULL,
  -- 1-based order of recording within the session.
  sequence integer NOT NULL CHECK (sequence > 0),
  exercise_id text NOT NULL,
  measurement jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, set_id),
  FOREIGN KEY (user_id, session_id)
    REFERENCES public.workout_sessions (user_id, id) ON DELETE CASCADE,
  UNIQUE (user_id, session_id, sequence)
);

-- A correction never edits the original value; it records what it was (D-012).
CREATE TABLE IF NOT EXISTS public.session_corrections (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  session_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  set_id text NOT NULL,
  previous jsonb NOT NULL,
  corrected jsonb NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'agent')),
  -- The user id, or for an agent the accepted proposal that carried the correction.
  actor_id text NOT NULL,
  corrected_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, session_id, revision),
  FOREIGN KEY (user_id, session_id)
    REFERENCES public.workout_sessions (user_id, id) ON DELETE CASCADE
);

-- Agent proposals -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.proposals (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  id text NOT NULL,
  -- The plan revision the proposal was computed against (ADR-0002). A moved base is stale.
  base_revision bigint NOT NULL CHECK (base_revision > 0),
  diff jsonb NOT NULL,
  rationale text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'stale')),
  created_at timestamptz NOT NULL,
  decided_at timestamptz,
  PRIMARY KEY (user_id, id),
  CONSTRAINT proposals_decided_fields CHECK (
    (status = 'pending') = (decided_at IS NULL)
  )
);

-- Idempotent replay -------------------------------------------------------------------------

-- Written in the same transaction as the mutation it describes (offline-sync spec, task 2.6),
-- so a replay returns the original result instead of applying the mutation twice. How long a
-- record is kept is an open product question and deliberately has no policy here yet.
CREATE TABLE IF NOT EXISTS public.idempotency_records (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  key uuid NOT NULL,
  -- A digest of the request body, so the same key with a different payload is refusable.
  request_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Row-level security ------------------------------------------------------------------------

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recorded_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records ENABLE ROW LEVEL SECURITY;

-- Forced, so even a table owner reading through the API is subject to the policies below.
ALTER TABLE public.plans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.workout_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.recorded_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.session_corrections FORCE ROW LEVEL SECURITY;
ALTER TABLE public.proposals FORCE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_records FORCE ROW LEVEL SECURITY;

CREATE POLICY plans_owner ON public.plans
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY workout_sessions_owner ON public.workout_sessions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY recorded_sets_owner ON public.recorded_sets
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY session_corrections_owner ON public.session_corrections
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY proposals_owner ON public.proposals
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY idempotency_records_owner ON public.idempotency_records
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Grants --------------------------------------------------------------------------------------

-- Deny by default: anon reaches none of these, and authenticated reaches only what a policy
-- then narrows to its own rows.
REVOKE ALL ON public.plans FROM PUBLIC, anon;
REVOKE ALL ON public.workout_sessions FROM PUBLIC, anon;
REVOKE ALL ON public.recorded_sets FROM PUBLIC, anon;
REVOKE ALL ON public.session_corrections FROM PUBLIC, anon;
REVOKE ALL ON public.proposals FROM PUBLIC, anon;
REVOKE ALL ON public.idempotency_records FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workout_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recorded_sets TO authenticated;
-- Corrections are append-only: the audit record of a change is not itself editable.
GRANT SELECT, INSERT ON public.session_corrections TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.proposals TO authenticated;
GRANT SELECT, INSERT ON public.idempotency_records TO authenticated;
