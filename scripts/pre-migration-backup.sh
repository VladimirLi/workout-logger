#!/usr/bin/env bash
# Pre-migration backup and restore drill (docs/runbooks/pre-migration-backup.md, R-015 to R-017).
#
#   pre-migration-backup.sh backup  --release <id>
#   pre-migration-backup.sh restore --release <id> --expect-sha256 <hex>
#
# `backup` dumps the `public` schema, proves the dump restores into a throwaway database with
# identical row counts, encrypts it to an age public key, uploads it outside Supabase and Vercel,
# downloads it again to prove the stored bytes match, and prints a manifest (with the SHA-256 of
# the stored artifact, bound to the release) on stdout. Everything else goes to stderr.
# `restore` is the drill: fetch, check the checksum against the one recorded by the backup job
# (required, and never read from the bucket: whoever can write the bucket can write a manifest),
# decrypt with the private key, restore into a throwaway database, compare row counts, and print a
# drill record.
#
# Fail closed: any error exits non-zero and prints no manifest. A deploy must depend on this
# exit status and must not proceed on anything else.
#
# Scope: the `public` schema. `auth` is managed by Supabase and a migration cannot write to it;
# only the user ids are carried, so foreign keys to auth.users can be restored.
#
# GUARDRAIL FILE.
set -Eeuo pipefail
umask 077

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BOOTSTRAP="$HERE/backup/throwaway-bootstrap.sql"
WORK=""
THROWAWAY_DB=""
export PGCONNECT_TIMEOUT=15
# libpq lets these redirect a connection whose URL names a safe host (PGHOSTADDR overrides the
# address even when a host is given; a service entry can supply host, hostaddr and dbname).
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGSERVICE PGSERVICEFILE

log() { printf 'pre-migration-backup: %s\n' "$*" >&2; }
die() { log "FAILED: $*"; exit 1; }
trap 'log "FAILED: command exited $? at line $LINENO"' ERR

cleanup() {
  local rc=$?
  if [[ -n "$THROWAWAY_DB" ]]; then
    psql "$RESTORE_ADMIN_URL" -X -qAt -c "DROP DATABASE IF EXISTS \"$THROWAWAY_DB\" WITH (FORCE)" \
      >/dev/null 2>&1 || log "warning: could not drop throwaway database $THROWAWAY_DB"
  fi
  if [[ -n "$WORK" ]]; then rm -rf "$WORK"; fi
  exit "$rc"
}
trap cleanup EXIT

need_env() { for name in "$@"; do [[ -n "${!name:-}" ]] || die "required environment variable $name is not set"; done; }
need_cmd() { for name in "$@"; do command -v "$name" >/dev/null || die "required command not found: $name"; done; }

sha256_of() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

url_host() { printf '%s' "$1" | sed -E 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#'; }

url_with_db() {
  local base="${1%%\?*}" query=""
  [[ "$1" == *\?* ]] && query="?${1#*\?}"
  printf '%s/%s%s' "${base%/*}" "$2" "$query"
}

# Row count of every table in `public`, as sorted compact JSON. Exact, not estimated.
row_counts() {
  psql "$1" -X -qAt -v ON_ERROR_STOP=1 -c "
    SELECT COALESCE(jsonb_object_agg(
      c.relname,
      (xpath('/row/c/text()',
        query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')
      ))[1]::text::bigint), '{}'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')" | jq -S -c .
}

# The restore target must be a loopback scratch server, never the database being protected.
# libpq lets a URI query (host, hostaddr, dbname, service, ...), a comma-separated host list or a
# key/value string redirect a connection that looks safe at a glance, and the script later
# creates and drops databases through this URL. So accept one exact shape and nothing else: no
# query, one loopback host, an optional port and a database name.
SCRATCH_URL_RE='^postgres(ql)?://([A-Za-z0-9._~%+=-]+(:[A-Za-z0-9._~%+=-]*)?@)?(127\.0\.0\.1|localhost|\[::1\])(:[0-9]{1,5})?/[A-Za-z0-9_]+$'
assert_scratch_target() {
  [[ "$RESTORE_ADMIN_URL" =~ $SCRATCH_URL_RE ]] ||
    die "RESTORE_ADMIN_URL must be a loopback throwaway server: a postgresql URL whose host is 127.0.0.1, localhost or [::1], with a database name and no query parameters"
  if [[ -n "${BACKUP_SOURCE_URL:-}" && "${BASH_REMATCH[4]}" == "$(url_host "$BACKUP_SOURCE_URL")" ]]; then
    die "RESTORE_ADMIN_URL and BACKUP_SOURCE_URL point at the same host (${BASH_REMATCH[4]})"
  fi
}

# The source role must see every row, or both the dump and the counts are silently partial: the
# public tables FORCE row level security, which a plain pg_read_all_data member is still subject
# to (pg_dump then fails; a count query just returns fewer rows). It must also be read-only.
assert_source_role() {
  local state
  state=$(psql "$BACKUP_SOURCE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
    SELECT (rolsuper OR rolbypassrls)::text || ' ' || current_setting('transaction_read_only')
    FROM pg_roles WHERE rolname = current_user")
  case "$state" in
    "true on") ;;
    "true off") die "the backup role is not read-only; set default_transaction_read_only = on on it (docs/runbooks/pre-migration-backup.md)" ;;
    *) die "the backup role cannot bypass row level security, so the dump and row counts would be partial; create it with BYPASSRLS (docs/runbooks/pre-migration-backup.md)" ;;
  esac
}

# Restore <dir>/public.dump into a fresh throwaway database and require the row counts recorded
# in <dir>/counts.json. Sets RESTORED_COUNTS. Not called in a subshell, so cleanup can drop the
# throwaway database however this fails.
RESTORED_COUNTS=""
verify_restore() {
  local dir=$1 expected actual url
  THROWAWAY_DB="verify_$(openssl rand -hex 6)"
  psql "$RESTORE_ADMIN_URL" -X -qAt -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$THROWAWAY_DB\"" >/dev/null
  url=$(url_with_db "$RESTORE_ADMIN_URL" "$THROWAWAY_DB")
  psql "$url" -X -q -v ON_ERROR_STOP=1 -f "$BOOTSTRAP" >/dev/null
  psql "$url" -X -q -v ON_ERROR_STOP=1 -c "\\copy auth.users (id) FROM '$dir/auth_user_ids.txt'" >/dev/null
  # Whether the dump creates `public` itself depends on the pg_dump version, so make both work.
  psql "$url" -X -q -v ON_ERROR_STOP=1 -c "DROP SCHEMA public" >/dev/null
  if ! pg_restore --list "$dir/public.dump" | grep -q ' SCHEMA - public '; then
    psql "$url" -X -q -v ON_ERROR_STOP=1 -c "CREATE SCHEMA public" >/dev/null
  fi
  pg_restore --exit-on-error --single-transaction --no-owner --no-acl --dbname "$url" "$dir/public.dump"
  expected=$(jq -S -c . "$dir/counts.json")
  actual=$(row_counts "$url")
  if [[ "$actual" != "$expected" ]]; then
    log "expected row counts: $expected"
    log "restored row counts: $actual"
    die "restored row counts differ from the dump"
  fi
  RESTORED_COUNTS=$actual
}

backup() {
  need_env BACKUP_SOURCE_URL RESTORE_ADMIN_URL BACKUP_STORE_URL BACKUP_AGE_RECIPIENT
  need_cmd pg_dump pg_restore psql age aws jq tar openssl
  assert_scratch_target
  [[ "$BACKUP_STORE_URL" == s3://* ]] || die "BACKUP_STORE_URL must be an s3:// URL"
  [[ "$BACKUP_AGE_RECIPIENT" =~ ^age1[a-z0-9]{50,}$ ]] || die "BACKUP_AGE_RECIPIENT is not an age public key (age1...)"

  WORK=$(mktemp -d "${TMPDIR:-/tmp}/pre-migration-backup.XXXXXX")
  local bundle="$WORK/bundle" started_at stamp prefix artifact_key manifest_key sha size before after
  mkdir "$bundle"
  started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  stamp=$(date -u +%Y%m%dT%H%M%SZ)

  assert_source_role
  log "counting rows in the source"
  before=$(row_counts "$BACKUP_SOURCE_URL")
  [[ "$before" != "{}" ]] || die "the source has no tables in public; refusing a backup that verifies nothing"

  log "dumping public"
  psql "$BACKUP_SOURCE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "SELECT id FROM auth.users ORDER BY id" >"$bundle/auth_user_ids.txt"
  pg_dump --format=custom --schema=public --no-owner --no-acl --lock-wait-timeout=60s \
    --file "$bundle/public.dump" "$BACKUP_SOURCE_URL"
  after=$(row_counts "$BACKUP_SOURCE_URL")
  [[ "$before" == "$after" ]] || die "the source changed while it was being dumped; retry with writes stopped"
  printf '%s\n' "$before" >"$bundle/counts.json"

  log "restoring the dump into a throwaway database to prove it is readable"
  verify_restore "$bundle"

  log "encrypting"
  tar -C "$bundle" -cf "$WORK/bundle.tar" public.dump auth_user_ids.txt counts.json
  age -r "$BACKUP_AGE_RECIPIENT" -o "$WORK/bundle.tar.age" "$WORK/bundle.tar"
  sha=$(sha256_of "$WORK/bundle.tar.age")
  size=$(wc -c <"$WORK/bundle.tar.age" | tr -d ' ')

  prefix="${BACKUP_STORE_URL%/}/$RELEASE"
  artifact_key="$prefix/$stamp.tar.age"
  manifest_key="$prefix/$stamp.json"
  log "uploading to $artifact_key"
  aws s3 cp --only-show-errors "$WORK/bundle.tar.age" "$artifact_key"
  aws s3 cp --only-show-errors "$artifact_key" "$WORK/downloaded.tar.age"
  [[ "$(sha256_of "$WORK/downloaded.tar.age")" == "$sha" ]] || die "the stored artifact does not match what was uploaded"

  if [[ -n "${BACKUP_AGE_IDENTITY_FILE:-}" ]]; then
    log "decrypting the stored artifact with the identity to prove the recipient is right"
    age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$WORK/roundtrip.tar" "$WORK/downloaded.tar.age"
    cmp -s "$WORK/roundtrip.tar" "$WORK/bundle.tar" || die "the decrypted artifact differs from what was encrypted"
  fi

  jq -n --arg release "$RELEASE" --arg created_at "$started_at" --arg sha "$sha" --argjson size "$size" \
    --arg artifact "${artifact_key##*/}" --argjson counts "$before" \
    --arg pg_dump "$(pg_dump --version)" --arg age "$(age --version)" \
    '{schema: 1, release: $release, created_at: $created_at, artifact: $artifact, sha256: $sha, size_bytes: $size,
      row_counts: $counts, tools: {pg_dump: $pg_dump, age: $age}}' >"$WORK/manifest.json"
  aws s3 cp --only-show-errors "$WORK/manifest.json" "$manifest_key"
  log "done: sha256 $sha bound to release $RELEASE"
  cat "$WORK/manifest.json"
}

restore() {
  need_env RESTORE_ADMIN_URL BACKUP_STORE_URL BACKUP_AGE_IDENTITY_FILE
  need_cmd pg_restore psql age aws jq tar openssl
  [[ -n "$EXPECT_SHA256" ]] || die "restore requires --expect-sha256, the checksum recorded by the backup job; it is not read from the bucket"
  [[ "$EXPECT_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "--expect-sha256 must be 64 lowercase hex characters"
  assert_scratch_target
  [[ -r "$BACKUP_AGE_IDENTITY_FILE" ]] || die "BACKUP_AGE_IDENTITY_FILE is not readable"

  WORK=$(mktemp -d "${TMPDIR:-/tmp}/pre-migration-restore.XXXXXX")
  SECONDS=0
  local prefix keys key manifest="" artifact sha=$EXPECT_SHA256
  prefix="${BACKUP_STORE_URL%/}/$RELEASE/"
  keys=$(aws s3 ls "$prefix" | awk '{print $NF}' | grep -E '^[0-9]{8}T[0-9]{6}Z\.json$' | sort || true)
  [[ -n "$keys" ]] || die "no backup manifest found under $prefix"

  # The bucket is writable by CI, so nothing in it is trusted to name its own checksum: pick the
  # manifest that records the externally supplied one, then hold the artifact to the same value.
  while IFS= read -r key; do
    aws s3 cp --only-show-errors "$prefix$key" "$WORK/candidate.json"
    if [[ "$(jq -r '.sha256? // empty' "$WORK/candidate.json" 2>/dev/null || true)" == "$sha" ]]; then
      manifest=$(jq -c . "$WORK/candidate.json")
      break
    fi
  done <<<"$keys"
  [[ -n "$manifest" ]] || die "no manifest under $prefix records the expected checksum $sha"
  artifact=$(jq -r '.artifact // empty' <<<"$manifest")
  [[ "$artifact" =~ ^[0-9]{8}T[0-9]{6}Z\.tar\.age$ ]] || die "the manifest names an artifact that is not a backup artifact: $artifact"
  aws s3 cp --only-show-errors "$prefix$artifact" "$WORK/bundle.tar.age"
  [[ "$(sha256_of "$WORK/bundle.tar.age")" == "$sha" ]] || die "the stored artifact does not match the expected checksum $sha"

  age -d -i "$BACKUP_AGE_IDENTITY_FILE" -o "$WORK/bundle.tar" "$WORK/bundle.tar.age"
  mkdir "$WORK/bundle"
  tar -C "$WORK/bundle" -xf "$WORK/bundle.tar" public.dump auth_user_ids.txt counts.json
  verify_restore "$WORK/bundle"
  [[ "$RESTORED_COUNTS" == "$(jq -S -c .row_counts <<<"$manifest")" ]] || die "the manifest row counts differ from the restored row counts"

  jq -n --arg release "$RELEASE" --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg sha "$sha" \
    --argjson seconds "$SECONDS" --argjson counts "$RESTORED_COUNTS" \
    '{release: $release, drill_date: $date, sha256: $sha, restore_duration_seconds: $seconds,
      row_counts: $counts, row_counts_match: true}'
}

COMMAND=${1:-}
shift || true
RELEASE=""
EXPECT_SHA256=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) RELEASE=${2:-}; shift 2 ;;
    --expect-sha256) EXPECT_SHA256=${2:-}; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ "$RELEASE" =~ ^[A-Za-z0-9._-]{1,100}$ ]] || die "--release is required (letters, digits, dot, dash, underscore)"

case "$COMMAND" in
  backup) backup ;;
  restore) restore ;;
  *) die "usage: pre-migration-backup.sh backup|restore --release <id>" ;;
esac
