#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${GAPURA_ENV_FILE:-$ROOT/.env}"
[[ -r "$ENV_FILE" ]] || { echo "ERROR: readable env file required: $ENV_FILE" >&2; exit 1; }

# This is an operator-owned shell env file. Do not use this script with an
# untrusted env file.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

[[ "${GAPURA_DB_ALLOW_INIT:-no}" == yes ]] || {
  echo 'ERROR: set GAPURA_DB_ALLOW_INIT=yes only for an explicitly selected fresh database.' >&2
  exit 1
}
[[ "${HME_DB_NAME:-}" =~ ^gapura_[a-z0-9_]+$ ]] || {
  echo 'ERROR: HME_DB_NAME must be a dedicated gapura_* database; refusing hme/n8n/other names.' >&2
  exit 1
}
[[ -n "${HME_DB_HOST:-}" && -n "${HME_DB_PORT:-}" && -n "${HME_DB_USER:-}" ]] || {
  echo 'ERROR: set HME_DB_HOST, HME_DB_PORT, and HME_DB_USER in the env file.' >&2
  exit 1
}
command -v psql >/dev/null || { echo 'ERROR: PostgreSQL client psql is required.' >&2; exit 1; }

export PGPASSWORD="${HME_DB_PASSWORD:-}"
PSQL=(psql -X -v ON_ERROR_STOP=1 -h "$HME_DB_HOST" -p "$HME_DB_PORT" -U "$HME_DB_USER" -d "$HME_DB_NAME")
TABLE_COUNT="$("${PSQL[@]}" -Atc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$TABLE_COUNT" == 0 ]] || {
  echo "ERROR: database already contains $TABLE_COUNT public table(s); initializer refuses to modify it." >&2
  exit 1
}
printf 'Initializing schema in explicitly selected database: %s@%s:%s/%s\n' \
  "$HME_DB_USER" "$HME_DB_HOST" "$HME_DB_PORT" "$HME_DB_NAME"
"${PSQL[@]}" -f "$ROOT/database/schema.sql"

# The base schema contains these two legacy-compatible migrations already;
# replay them idempotently, then apply subsequent dated migrations in stable
# bytewise order so publication_targets exists before its revision migration.
"${PSQL[@]}" -f "$ROOT/database/migrations/20261111_seo_verifikator.sql"
"${PSQL[@]}" -f "$ROOT/database/migrations/20261111_prompt_studio.sql"
while IFS= read -r migration; do
  "${PSQL[@]}" -f "$migration"
done < <(find "$ROOT/database/migrations" -maxdepth 1 -type f -name '*.sql' \
  ! -name '20261111_*' -print | LC_ALL=C sort)

printf 'PASS: schema and migrations installed in %s. Seed configuration rows are present; no editorial data was imported.\n' "$HME_DB_NAME"
