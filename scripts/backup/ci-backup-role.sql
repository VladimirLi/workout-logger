-- The read-only credential the backup job dumps with. Run once per environment, as `postgres`.
-- The password is read from the environment so it never appears in psql's argv (visible to every
-- local user through `ps`) or in shell history:
--   export BACKUP_ROLE_PASSWORD=$(openssl rand -hex 24)
--   psql "postgresql://postgres.<project-ref>@<pooler-host>:5432/postgres" \
--     -v backup_role=ci_backup -f scripts/backup/ci-backup-role.sql
-- psql prompts for the postgres password. The rehearsal (scripts/pre-migration-backup-rehearsal.sh)
-- creates the role from this same file.
--
-- Why BYPASSRLS: the public tables FORCE row level security, and a pg_read_all_data member is
-- still filtered by it, so pg_dump fails and row counts come back partial. BYPASSRLS is an
-- attribute of this one role. It adds no policy, relaxes none, and leaves every application role
-- (anon, authenticated, service_role) exactly as the migrations defined it. Read-only comes from
-- pg_read_all_data granting SELECT and nothing else, plus a read-only default the script checks.
-- GUARDRAIL FILE.
\set ON_ERROR_STOP on
\set backup_password `printenv BACKUP_ROLE_PASSWORD`
SELECT length(:'backup_password') >= 32 AS password_ok \gset
\if :password_ok
\else
  DO $$ BEGIN RAISE EXCEPTION 'BACKUP_ROLE_PASSWORD must be set in the environment to 32 or more characters'; END $$;
\endif
CREATE ROLE :"backup_role" LOGIN CONNECTION LIMIT 2 BYPASSRLS PASSWORD :'backup_password';
GRANT pg_read_all_data TO :"backup_role";
ALTER ROLE :"backup_role" SET default_transaction_read_only = on;
