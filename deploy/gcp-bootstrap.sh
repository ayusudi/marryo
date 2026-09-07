#!/usr/bin/env bash
# One-time GCP bootstrap for Marryo (Cloud Run + Cloud SQL + GCS + Vertex).
# Usage:
#   export PROJECT_ID=your-gcp-project
#   export REGION=us-central1
#   ./deploy/gcp-bootstrap.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SQL_INSTANCE="${SQL_INSTANCE:-marryo-pg}"
SQL_DB="${SQL_DB:-marryo}"
SQL_USER="${SQL_USER:-marryo}"
BUCKET="${BUCKET:-${PROJECT_ID}-marryo}"
AR_REPO="${AR_REPO:-marryo}"
SA_NAME="${SA_NAME:-marryo-run}"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> Project ${PROJECT_ID} / ${REGION}"
gcloud config set project "${PROJECT_ID}"

echo "==> Enable APIs"
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  storage.googleapis.com \
  aiplatform.googleapis.com \
  iam.googleapis.com \
  --project="${PROJECT_ID}"

echo "==> Artifact Registry"
gcloud artifacts repositories describe "${AR_REPO}" --location="${REGION}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "${AR_REPO}" \
       --repository-format=docker \
       --location="${REGION}" \
       --description="Marryo Cloud Run images"

echo "==> Service account ${SA_EMAIL}"
gcloud iam service-accounts describe "${SA_EMAIL}" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "${SA_NAME}" --display-name="Marryo Cloud Run"

for ROLE in \
  roles/aiplatform.user \
  roles/storage.objectAdmin \
  roles/cloudsql.client \
  roles/secretmanager.secretAccessor \
  roles/logging.logWriter \
  roles/monitoring.metricWriter
do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet >/dev/null
done

echo "==> GCS bucket gs://${BUCKET}"
gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${BUCKET}" --location="${REGION}" --uniform-bucket-level-access

echo "==> Cloud SQL (${SQL_INSTANCE})"
if ! gcloud sql instances describe "${SQL_INSTANCE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  SQL_PASSWORD="${SQL_PASSWORD:-$(openssl rand -base64 24)}"
  echo "Creating Cloud SQL… (password printed once below)"
  gcloud sql instances create "${SQL_INSTANCE}" \
    --database-version=POSTGRES_16 \
    --edition=ENTERPRISE \
    --tier=db-f1-micro \
    --region="${REGION}" \
    --storage-size=20GB \
    --storage-auto-increase \
    --root-password="${SQL_PASSWORD}"
  echo "ROOT/TEMP note: set app user password next."
  echo "SQL_PASSWORD=${SQL_PASSWORD}"
fi

gcloud sql databases describe "${SQL_DB}" --instance="${SQL_INSTANCE}" >/dev/null 2>&1 \
  || gcloud sql databases create "${SQL_DB}" --instance="${SQL_INSTANCE}"

if ! gcloud sql users list --instance="${SQL_INSTANCE}" --format='value(name)' | grep -qx "${SQL_USER}"; then
  APP_PASSWORD="${SQL_PASSWORD:-$(openssl rand -base64 24)}"
  gcloud sql users create "${SQL_USER}" --instance="${SQL_INSTANCE}" --password="${APP_PASSWORD}"
  echo "Created SQL user ${SQL_USER} / password: ${APP_PASSWORD}"
  echo "Store as Secret Manager marryo-database-url (see deploy/gcp.md)"
fi

CONNECTION_NAME="$(gcloud sql instances describe "${SQL_INSTANCE}" --format='value(connectionName)')"
echo ""
echo "Bootstrap done."
echo "  PROJECT_ID=${PROJECT_ID}"
echo "  REGION=${REGION}"
echo "  BUCKET=${BUCKET}"
echo "  CLOUD_SQL_CONNECTION=${CONNECTION_NAME}"
echo "  SA_EMAIL=${SA_EMAIL}"
echo "  IMAGE_PREFIX=${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
echo ""
echo "Next: create ClickHouse Cloud service, fill deploy/env.cloud.example → Secret Manager,"
echo "then run ./deploy/gcp-deploy.sh"
