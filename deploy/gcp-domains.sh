#!/usr/bin/env bash
# Map custom domains to Cloud Run (after first deploy of marryo-web / marryo-agent).
#
# Planned hostnames:
#   marryo.ayusudi.com        → marryo-web  (FE + Next API)
#   server-marryo.ayusudi.com  → marryo-web  (same service; API-style hostname)
#   ai-marryo.ayusudi.com      → marryo-agent (ADK)
#
# Usage:
#   export PROJECT_ID=marryo-101026
#   export REGION=asia-southeast1
#   ./deploy/gcp-domains.sh
#
# Then at your DNS for ayusudi.com, create the records gcloud prints (usually CNAME).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?Set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
FE_DOMAIN="${FE_DOMAIN:-marryo.ayusudi.com}"
SERVER_DOMAIN="${SERVER_DOMAIN:-server-marryo.ayusudi.com}"
AI_DOMAIN="${AI_DOMAIN:-ai-marryo.ayusudi.com}"

gcloud config set project "${PROJECT_ID}"

map_domain() {
  local domain="$1"
  local service="$2"
  echo "==> Domain ${domain} → ${service}"
  if gcloud beta run domain-mappings describe --domain="${domain}" --region="${REGION}" >/dev/null 2>&1 \
    || gcloud run domain-mappings describe --domain="${domain}" --region="${REGION}" >/dev/null 2>&1; then
    echo "    already mapped"
  else
    gcloud beta run domain-mappings create \
      --service="${service}" \
      --domain="${domain}" \
      --region="${REGION}" \
      || gcloud run domain-mappings create \
           --service="${service}" \
           --domain="${domain}" \
           --region="${REGION}"
  fi
  echo "    DNS records:"
  gcloud beta run domain-mappings describe --domain="${domain}" --region="${REGION}" \
    --format='yaml(status.resourceRecords)' 2>/dev/null \
    || gcloud run domain-mappings describe --domain="${domain}" --region="${REGION}" \
         --format='yaml(status.resourceRecords)' 2>/dev/null \
    || true
}

map_domain "${FE_DOMAIN}" marryo-web
map_domain "${SERVER_DOMAIN}" marryo-web
map_domain "${AI_DOMAIN}" marryo-agent

echo ""
echo "After DNS propagates + certificate becomes Active:"
echo "  AUTH_URL=https://${FE_DOMAIN}"
echo "  AGENT_SERVICE_URL=https://${AI_DOMAIN}"
echo "  OAuth redirect: https://${FE_DOMAIN}/api/auth/callback/google"
echo "Redeploy web with those env vars (./deploy/gcp-deploy.sh)."
