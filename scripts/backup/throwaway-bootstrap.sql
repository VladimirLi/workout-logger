-- Minimum of what Supabase provides that the `public` schema depends on: the three API roles,
-- an `auth.users` table to satisfy foreign keys, and `auth.uid()`. It is loaded only into a
-- throwaway database created by scripts/pre-migration-backup.sh, never into a real project.
-- GUARDRAIL FILE.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
