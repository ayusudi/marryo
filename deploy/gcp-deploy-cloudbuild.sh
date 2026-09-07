#!/usr/bin/env bash
# Deploy using Cloud Build (no local Docker). Prerequisites: secrets + prisma + clickhouse.
#
#   export PROJECT_ID=marryo-101026
#   export REGION=asia-southeast1
#   export CLOUD_SQL_CONNECTION=marryo-101026:asia-southeast1:marryo-pg
#   ./deploy/gcp-deploy-cloudbuild.sh
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

# Cloud Build SA needs Artifact Registry writer
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/artifactregistry.writer" \
  --condition=None \
  --quiet >/dev/null || true

echo "==> Cloud Build (web + agent) tag=${TAG}"
gcloud builds submit \
  --config=deploy/cloudbuild.yaml \
  --substitutions="_REGION=${REGION},_AR_REPO=${AR_REPO},_TAG=${TAG}" \
  --timeout=3600s

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
echo "Agent Cloud Run: ${AGENT_RUN_URL}"
echo "Agent (configured): ${AGENT_URL}"

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
echo "  Web (Cloud Run): ${WEB_URL}"
echo "  Agent (Cloud Run): ${AGENT_RUN_URL}"
echo "  FE: https://${FE_DOMAIN}"
echo "  AI: ${AGENT_URL}"
echo "Next: ./deploy/gcp-domains.sh"
