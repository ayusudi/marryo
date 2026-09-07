#!/usr/bin/env bash
# Deploy already-built images from Artifact Registry to Cloud Run (no local Docker).
# Prefer: gcloud builds submit --config deploy/cloudbuild.yaml first.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
AR_REPO="${AR_REPO:-marryo}"
SA_EMAIL="${SA_EMAIL:-marryo-run@${PROJECT_ID}.iam.gserviceaccount.com}"
CLOUD_SQL_CONNECTION="${CLOUD_SQL_CONNECTION:?Set CLOUD_SQL_CONNECTION}"
BUCKET="${BUCKET:-${PROJECT_ID}-marryo}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
PREFIX="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
WEB_IMAGE="${PREFIX}/web:${TAG}"
AGENT_IMAGE="${PREFIX}/agent:${TAG}"
FE_DOMAIN="${FE_DOMAIN:-marryo.ayusudi.com}"
AI_DOMAIN="${AI_DOMAIN:-ai-marryo.ayusudi.com}"
AUTH_URL="${AUTH_URL:-https://${FE_DOMAIN}}"
AGENT_URL="${AGENT_URL:-https://${AI_DOMAIN}}"

gcloud config set project "${PROJECT_ID}"

echo "==> Deploy agent ${AGENT_IMAGE}"
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

echo "==> Deploy web ${WEB_IMAGE}"
ENV_VARS="GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},GOOGLE_GENAI_USE_VERTEXAI=1,GOOGLE_CLOUD_STORAGE_BUCKET=${BUCKET},STORAGE_BACKEND=gcs,AGENT_SERVICE_URL=${AGENT_URL},PYTHON_BIN=/opt/agent/.venv/bin/python,FFMPEG_BIN=ffmpeg,PIPELINE_USE_GEMINI=1,MOCK_GEMINI=0,E2E_AUTH=0,CLICKHOUSE_PORT=8443,MAX_CLIPS_PER_PROJECT=6,AUTH_URL=${AUTH_URL}"

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
echo "  Web:   ${WEB_URL}"
echo "  Agent: ${AGENT_RUN_URL}"
echo "  FE:    ${AUTH_URL}"
echo "  AI:    ${AGENT_URL}"
echo "Next: ./deploy/gcp-domains.sh"
