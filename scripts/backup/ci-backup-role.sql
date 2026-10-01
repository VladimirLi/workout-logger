-- The read-only credential the backup job dumps with. Run once per environment, as `postgres`:
--   psql "<postgres role URL>" -v backup_role=ci_backup -v backup_password='<32+ characters>' \
--     -f scripts/backup/ci-backup-role.sql
-- The rehearsal (scripts/pre-migration-backup-rehearsal.sh) creates the role from this same file.
--
-- Why BYPASSRLS: the public tables FORCE row level security, and a pg_read_all_data member is
-- still filtered by it, so pg_dump fails and row counts come back partial. BYPASSRLS is an
-- attribute of this one role. It adds no policy, relaxes none, and leaves every application role
-- (anon, authenticated, service_role) exactly as the migrations defined it. Read-only comes from
-- pg_read_all_data granting SELECT and nothing else, plus a read-only default the script checks.
-- GUARDRAIL FILE.
CREATE ROLE :"backup_role" LOGIN CONNECTION LIMIT 2 BYPASSRLS PASSWORD :'backup_password';
GRANT pg_read_all_data TO :"backup_role";
ALTER ROLE :"backup_role" SET default_transaction_read_only = on;
