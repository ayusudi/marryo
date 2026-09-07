#!/usr/bin/env bash
# Create/update Secret Manager values from a local file (never commit that file).
# Usage:
#   cp deploy/env.cloud.example deploy/env.cloud.local
#   # fill in values
#   ./deploy/gcp-secrets.sh deploy/env.cloud.local
set -euo pipefail

FILE="${1:?Usage: $0 path/to/env.cloud.local}"
PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"

gcloud config set project "${PROJECT_ID}"

upsert() {
  local name="$1"
  local value="$2"
  if [ -z "${value}" ]; then
    echo "skip ${name} (empty)"
    return
  fi
  if gcloud secrets describe "${name}" >/dev/null 2>&1; then
    printf '%s' "${value}" | gcloud secrets versions add "${name}" --data-file=-
  else
    printf '%s' "${value}" | gcloud secrets create "${name}" --data-file=-
  fi
  echo "ok ${name}"
}

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "${FILE}"
set +a

upsert marryo-database-url "${DATABASE_URL:-}"
upsert marryo-auth-secret "${AUTH_SECRET:-}"
upsert marryo-auth-google-id "${AUTH_GOOGLE_ID:-}"
upsert marryo-auth-google-secret "${AUTH_GOOGLE_SECRET:-}"
upsert marryo-clickhouse-host "${CLICKHOUSE_HOST:-}"
upsert marryo-clickhouse-user "${CLICKHOUSE_USER:-}"
upsert marryo-clickhouse-password "${CLICKHOUSE_PASSWORD:-}"
upsert marryo-clickhouse-database "${CLICKHOUSE_DATABASE:-marryo}"

echo "Secrets synced."
