#!/usr/bin/env bash
# Build + deploy Marryo web + agent to Cloud Run.
# Prerequisites: ./deploy/gcp-bootstrap.sh and Secret Manager secrets (see gcp.md).
#
#   export PROJECT_ID=...
#   export REGION=us-central1
#   export CLOUD_SQL_CONNECTION=project:region:marryo-pg
#   export AUTH_URL=https://marryo.ayusudi.com
#   export AGENT_URL=https://ai-marryo.ayusudi.com   # optional; defaults to Cloud Run URL
#   ./deploy/gcp-deploy.sh
# Domain mapping: ./deploy/gcp-domains.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
AR_REPO="${AR_REPO:-marryo}"
SA_EMAIL="${SA_EMAIL:-marryo-run@${PROJECT_ID}.iam.gserviceaccount.com}"
CLOUD_SQL_CONNECTION="${CLOUD_SQL_CONNECTION:?Set CLOUD_SQL_CONNECTION (project:region:instance)}"
BUCKET="${BUCKET:-${PROJECT_ID}-marryo}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
PREFIX="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
WEB_IMAGE="${PREFIX}/web:${TAG}"
AGENT_IMAGE="${PREFIX}/agent:${TAG}"
# Production hostnames (override if needed)
FE_DOMAIN="${FE_DOMAIN:-marryo.ayusudi.com}"
AI_DOMAIN="${AI_DOMAIN:-ai-marryo.ayusudi.com}"
AUTH_URL="${AUTH_URL:-https://${FE_DOMAIN}}"

gcloud config set project "${PROJECT_ID}"
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "==> Build web ${WEB_IMAGE}"
docker build -f Dockerfile.web -t "${WEB_IMAGE}" .
echo "==> Build agent ${AGENT_IMAGE}"
docker build -f Dockerfile.agent -t "${AGENT_IMAGE}" .

echo "==> Push"
docker push "${WEB_IMAGE}"
docker push "${AGENT_IMAGE}"

echo "==> Deploy agent"
gcloud run deploy marryo-agent \
  --image="${AGENT_IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SA_EMAIL}" \
  --allow-unauthenticated \
  --memory=2Gi \
  --cpu=2 \
  --timeout=300 \
  --concurrency=4 \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=1,GOOGLE_CLOUD_STORAGE_BUCKET=${BUCKET},STORAGE_BACKEND=gcs,MARRYO_MODEL=gemini-2.5-flash" \
  --set-secrets="CLICKHOUSE_HOST=marryo-clickhouse-host:latest,CLICKHOUSE_PASSWORD=marryo-clickhouse-password:latest,CLICKHOUSE_USER=marryo-clickhouse-user:latest,CLICKHOUSE_DATABASE=marryo-clickhouse-database:latest"

AGENT_RUN_URL="$(gcloud run services describe marryo-agent --region="${REGION}" --format='value(status.url)')"
# Prefer custom AI domain when set; Cloud Run URL works before DNS is ready.
AGENT_URL="${AGENT_URL:-https://${AI_DOMAIN}}"
echo "Agent Cloud Run: ${AGENT_RUN_URL}"
echo "Agent (web will call): ${AGENT_URL}"

echo "==> Deploy web"
AUTH_URL_VALUE="${AUTH_URL}"
ENV_VARS="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=1,GOOGLE_CLOUD_STORAGE_BUCKET=${BUCKET},STORAGE_BACKEND=gcs,AGENT_SERVICE_URL=${AGENT_URL},PYTHON_BIN=/opt/agent/.venv/bin/python,FFMPEG_BIN=ffmpeg,PIPELINE_USE_GEMINI=1,MOCK_GEMINI=0,E2E_AUTH=0,CLICKHOUSE_PORT=8443,MAX_CLIPS_PER_PROJECT=6,AUTH_URL=${AUTH_URL_VALUE}"

gcloud run deploy marryo-web \
  --image="${WEB_IMAGE}" \
  --region="${REGION}" \
  --platform=managed \
  --service-account="${SA_EMAIL}" \
  --allow-unauthenticated \
  --memory=4Gi \
  --cpu=2 \
  --timeout=900 \
  --concurrency=2 \
  --min-instances=0 \
  --max-instances=5 \
  --cpu-boost \
  --add-cloudsql-instances="${CLOUD_SQL_CONNECTION}" \
  --set-env-vars="${ENV_VARS}" \
  --set-secrets="DATABASE_URL=marryo-database-url:latest,AUTH_SECRET=marryo-auth-secret:latest,AUTH_GOOGLE_ID=marryo-auth-google-id:latest,AUTH_GOOGLE_SECRET=marryo-auth-google-secret:latest,CLICKHOUSE_HOST=marryo-clickhouse-host:latest,CLICKHOUSE_PASSWORD=marryo-clickhouse-password:latest,CLICKHOUSE_USER=marryo-clickhouse-user:latest,CLICKHOUSE_DATABASE=marryo-clickhouse-database:latest"

WEB_URL="$(gcloud run services describe marryo-web --region="${REGION}" --format='value(status.url)')"
echo ""
echo "Deployed:"
echo "  Web (Cloud Run): ${WEB_URL}"
echo "  Agent (Cloud Run): ${AGENT_RUN_URL}"
echo "  FE domain:     https://${FE_DOMAIN}"
echo "  Server domain: https://server-marryo.ayusudi.com (same web service)"
echo "  AI domain:     ${AGENT_URL}"
echo ""
echo "Map DNS: ./deploy/gcp-domains.sh"
echo "OAuth redirect: https://${FE_DOMAIN}/api/auth/callback/google"
echo ""
echo "Apply schema once (Cloud SQL Auth Proxy or Cloud Shell):"
echo "  export DATABASE_URL='postgresql://marryo:PASSWORD@127.0.0.1:5432/marryo'"
echo "  npx prisma db push --schema prisma/schema.prisma"
echo "  npm run db:clickhouse"
