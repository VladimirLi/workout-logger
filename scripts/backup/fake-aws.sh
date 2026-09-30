#!/usr/bin/env bash
# Stand-in for `aws s3 cp` and `aws s3 ls` that maps s3://bucket/key onto $FAKE_S3_DIR/bucket/key.
# Used only by the rehearsal, so it can run with no bucket. It proves the script's logic, not the
# S3 transport. GUARDRAIL FILE.
set -euo pipefail
[[ "${1:-}" == "s3" ]] || { echo "fake aws: only 's3' is supported" >&2; exit 2; }
sub=$2
shift 2
args=()
for a in "$@"; do [[ "$a" == --* ]] || args+=("$a"); done
path() { case "$1" in s3://*) printf '%s/%s' "$FAKE_S3_DIR" "${1#s3://}" ;; *) printf '%s' "$1" ;; esac; }
case "$sub" in
  cp) mkdir -p "$(dirname "$(path "${args[1]}")")"; cp "$(path "${args[0]}")" "$(path "${args[1]}")" ;;
  ls) for f in "$(path "${args[0]}")"*; do [[ -f "$f" ]] && printf '2026-01-01 00:00:00 %10d %s\n' "$(wc -c <"$f")" "$(basename "$f")"; done; true ;;
  *) echo "fake aws: unsupported subcommand $sub" >&2; exit 2 ;;
esac
