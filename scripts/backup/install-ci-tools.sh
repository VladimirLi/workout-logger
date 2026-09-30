#!/usr/bin/env bash
# Tools the backup scripts need on an ubuntu GitHub runner. The Postgres client must match the
# server's major version (17, as on Supabase): a newer pg_dump refuses an older server and a
# restore across majors is not what is being proven. aws and jq are preinstalled on the runner.
# GUARDRAIL FILE.
set -euo pipefail
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
sudo apt-get install -y --no-install-recommends postgresql-client-17 age >/dev/null
export PATH="/usr/lib/postgresql/17/bin:$PATH"
[[ "$(pg_dump --version)" == *" 17."* ]] || { echo "pg_dump is not version 17: $(pg_dump --version)" >&2; exit 1; }
echo "/usr/lib/postgresql/17/bin" >>"${GITHUB_PATH:?not running on GitHub Actions}"
age --version
aws --version
jq --version
