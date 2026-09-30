#!/usr/bin/env bash
# Rehearsal of scripts/pre-migration-backup.sh against scratch Postgres servers, with no cloud
# resource and no credential. It builds a source database by applying every committed migration,
# adds rows, then proves the script (1) backs up and restores with matching counts, (2) refuses
# each way the backup could be unsound. Failing any expectation fails the rehearsal.
#
#   REHEARSAL_PG_URL=postgresql://user@127.0.0.1:port/postgres scripts/pre-migration-backup-rehearsal.sh
#
# REHEARSAL_PG_URL must use the host 127.0.0.1. The server it names must be disposable: the rehearsal creates and drops
# databases on it and creates the roles anon, authenticated and service_role.
# GUARDRAIL FILE.
set -Eeuo pipefail
umask 077

: "${REHEARSAL_PG_URL:?set REHEARSAL_PG_URL to a disposable Postgres server}"
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SCRIPT="$ROOT/scripts/pre-migration-backup.sh"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/backup-rehearsal.XXXXXX")
SRC_DB="rehearsal_src_$(openssl rand -hex 4)"
trap 'psql "$REHEARSAL_PG_URL" -X -qAt -c "DROP DATABASE IF EXISTS \"$SRC_DB\" WITH (FORCE)" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

url_with_db() {
  local base="${1%%\?*}" query=""
  [[ "$1" == *\?* ]] && query="?${1#*\?}"
  printf '%s/%s%s' "${base%/*}" "$2" "$query"
}
fail() { echo "rehearsal: FAILED: $*" >&2; exit 1; }
expect_failure() {
  local name=$1 pattern=$2
  shift 2
  if out=$("$@" 2>&1 >/dev/null); then fail "$name: expected the script to fail, but it succeeded"; fi
  grep -q -- "$pattern" <<<"$out" || { echo "$out" >&2; fail "$name: failed, but not with '$pattern'"; }
  echo "rehearsal: ok - $name refused ($pattern)"
}

psql "$REHEARSAL_PG_URL" -X -q -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SRC_DB\""
SRC_URL=$(url_with_db "$REHEARSAL_PG_URL" "$SRC_DB")
psql "$SRC_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/scripts/backup/throwaway-bootstrap.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do
  psql "$SRC_URL" -X -q -v ON_ERROR_STOP=1 --single-transaction -f "$migration" >/dev/null
done
# Rows in the tables the migrations create, and the users they reference.
psql "$SRC_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO auth.users (id) VALUES ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b');
INSERT INTO public.plans (user_id, id, revision, status, activated_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'plan-1', 1, 'active', now()),
  ('00000000-0000-0000-0000-00000000000b', 'plan-1', 1, 'active', now());
INSERT INTO public.workout_sessions (user_id, id, plan_id, plan_revision, scheduled_session_id, started_at, status) VALUES
  ('00000000-0000-0000-0000-00000000000a', 's1', 'plan-1', 1, 'day-a', now(), 'active');
INSERT INTO public.recorded_sets (user_id, set_id, session_id, sequence, exercise_id, measurement, recorded_at) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'set1', 's1', 1, 'squat',
   '{"kind":"weight_reps","load":{"value":100,"unit":"kg"},"reps":5}', now());
SQL

age-keygen -o "$TMP/identity.txt" 2>/dev/null
RECIPIENT=$(age-keygen -y "$TMP/identity.txt")
export FAKE_S3_DIR="$TMP/bucket" PATH="$TMP/bin:$PATH"
mkdir -p "$TMP/bin" "$FAKE_S3_DIR"
ln -s "$ROOT/scripts/backup/fake-aws.sh" "$TMP/bin/aws"
# One server plays both roles, so the source is addressed as `localhost` and the restore target as
# `127.0.0.1`: the script refuses two URLs with the same host, which is the guard under test.
export BACKUP_SOURCE_URL="${SRC_URL/127.0.0.1/localhost}" RESTORE_ADMIN_URL="$REHEARSAL_PG_URL"
export TMPDIR="$TMP/scratch"
mkdir -p "$TMPDIR"
export BACKUP_STORE_URL="s3://rehearsal/backups" BACKUP_AGE_RECIPIENT="$RECIPIENT" BACKUP_AGE_IDENTITY_FILE="$TMP/identity.txt"

echo "rehearsal: happy path" >&2
"$SCRIPT" backup --release rehearsal-1 >"$TMP/manifest.json"
SHA=$(jq -r .sha256 "$TMP/manifest.json")
[[ "$SHA" =~ ^[0-9a-f]{64}$ ]] || fail "manifest has no sha256"
[[ "$(jq '.row_counts | length' "$TMP/manifest.json")" -gt 0 ]] || fail "manifest has no row counts"
"$SCRIPT" restore --release rehearsal-1 --expect-sha256 "$SHA" >"$TMP/drill.json"
[[ "$(jq -r .row_counts_match "$TMP/drill.json")" == "true" ]] || fail "drill did not match row counts"
cat "$TMP/drill.json"

echo "rehearsal: refusals" >&2
ARTIFACT=$(find "$FAKE_S3_DIR" -name '*.tar.age' | head -n 1)
cp "$ARTIFACT" "$TMP/artifact.good"
printf 'x' >>"$ARTIFACT"
expect_failure "a tampered artifact" "does not match its recorded checksum" "$SCRIPT" restore --release rehearsal-1
cp "$TMP/artifact.good" "$ARTIFACT"
expect_failure "a different recorded checksum" "differs from the recorded checksum" \
  "$SCRIPT" restore --release rehearsal-1 --expect-sha256 "$(printf '0%.0s' {1..64})"
expect_failure "an unknown release" "no backup manifest" "$SCRIPT" restore --release nothing-here
expect_failure "a wrong private key" "no identity matched" env "BACKUP_AGE_IDENTITY_FILE=$TMP/other.txt" \
  bash -c "age-keygen -o '$TMP/other.txt' 2>/dev/null; exec '$SCRIPT' restore --release rehearsal-1"
expect_failure "a missing recipient" "BACKUP_AGE_RECIPIENT" env -u BACKUP_AGE_RECIPIENT "$SCRIPT" backup --release rehearsal-2
expect_failure "a bad recipient" "not an age public key" env BACKUP_AGE_RECIPIENT=age1short "$SCRIPT" backup --release rehearsal-2
expect_failure "a restore target on Supabase" "throwaway server" \
  env RESTORE_ADMIN_URL=postgresql://u@db.example.supabase.co:5432/postgres "$SCRIPT" backup --release rehearsal-2
expect_failure "a restore target that is the source" "same host" \
  env BACKUP_SOURCE_URL="$SRC_URL" "$SCRIPT" backup --release rehearsal-2
expect_failure "an unreachable source" "" env BACKUP_SOURCE_URL="postgresql://nobody@127.0.0.1:1/none" "$SCRIPT" backup --release rehearsal-2
expect_failure "an upload that fails" "" env PATH="$TMP/nobin:$PATH" \
  bash -c "mkdir -p '$TMP/nobin'; printf '#!/bin/sh\nexit 1\n' >'$TMP/nobin/aws'; chmod +x '$TMP/nobin/aws'; exec '$SCRIPT' backup --release rehearsal-3"
# Wrappers that let the real tool run and then break the one property the script must notice.
REAL_PG_DUMP=$(command -v pg_dump)
REAL_PG_RESTORE=$(command -v pg_restore)
mkdir -p "$TMP/writes" "$TMP/loss"
cat >"$TMP/writes/pg_dump" <<SH
#!/bin/sh
"$REAL_PG_DUMP" "\$@" || exit \$?
psql "$SRC_URL" -X -q -c "INSERT INTO public.recorded_sets (user_id, set_id, session_id, sequence, exercise_id, measurement, recorded_at) SELECT user_id, 'late', session_id, 2, exercise_id, measurement, now() FROM public.recorded_sets LIMIT 1"
SH
cat >"$TMP/loss/pg_restore" <<SH
#!/bin/sh
"$REAL_PG_RESTORE" "\$@" || exit \$?
while [ \$# -gt 0 ]; do
  if [ "\$1" = --dbname ]; then psql "\$2" -X -q -c "DELETE FROM public.recorded_sets" || exit 1; fi
  shift
done
SH
chmod +x "$TMP/writes/pg_dump" "$TMP/loss/pg_restore"
expect_failure "a source that changes during the dump" "changed while it was being dumped" \
  env PATH="$TMP/writes:$PATH" "$SCRIPT" backup --release rehearsal-4
psql "$SRC_URL" -X -q -c "DELETE FROM public.recorded_sets WHERE set_id = 'late'"
expect_failure "a restore that loses rows" "differ from the dump" \
  env PATH="$TMP/loss:$PATH" "$SCRIPT" backup --release rehearsal-5
psql "$REHEARSAL_PG_URL" -X -q -c "CREATE DATABASE \"${SRC_DB}_empty\""
psql "$(url_with_db "$REHEARSAL_PG_URL" "${SRC_DB}_empty")" -X -q -f "$ROOT/scripts/backup/throwaway-bootstrap.sql"
expect_failure "a source with nothing in it" "verifies nothing" \
  env BACKUP_SOURCE_URL="$(url_with_db "${REHEARSAL_PG_URL/127.0.0.1/localhost}" "${SRC_DB}_empty")" "$SCRIPT" backup --release rehearsal-6
psql "$REHEARSAL_PG_URL" -X -q -c "DROP DATABASE \"${SRC_DB}_empty\" WITH (FORCE)"

[[ -z "$(find "$FAKE_S3_DIR" -path '*rehearsal-[2-6]*')" ]] || fail "a refused backup left objects behind"
[[ -z "$(find "$TMPDIR" -mindepth 1)" ]] || fail "a run left its working files, which include a plaintext dump, behind"

leftover=$(psql "$REHEARSAL_PG_URL" -X -qAt -c "SELECT count(*) FROM pg_database WHERE datname LIKE 'verify\_%'")
[[ "$leftover" == "0" ]] || fail "$leftover throwaway databases were left behind"
echo "rehearsal: passed"
