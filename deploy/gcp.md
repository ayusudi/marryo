# Deploy Marryo on GCP (all-in)

Target architecture:

| Piece | Service |
|-------|---------|
| Studio UI + API + FFmpeg/CV CLIs | **Cloud Run** `marryo-web` |
| ADK Film Director HTTP | **Cloud Run** `marryo-agent` |
| Uploads / renders | **GCS** |
| App DB (Prisma) | **Cloud SQL** PostgreSQL 16 |
| Moments / scenes | **ClickHouse Cloud** |
| Gemini | **Vertex AI** (ADC via Cloud Run SA) |

> **Important:** Identity, scene detect, Direct, render, and soundtrack spawn **Python + FFmpeg inside the web container** today. `marryo-agent` serves ADK (`/list-apps` and tool APIs). Do not shrink the web image to Node-only.

## Prerequisites

- `gcloud` CLI, Docker, Node 22+, Python 3.13 locally for schema push
- Billing-enabled GCP project
- [ClickHouse Cloud](https://clickhouse.cloud) service (HTTPS + password user)
- Google OAuth Web client (Auth.js) with production redirect URI

## 1. Bootstrap GCP

```bash
export PROJECT_ID=your-project-id
export REGION=asia-southeast1   # match ClickHouse Cloud (Singapore)
chmod +x deploy/gcp-bootstrap.sh deploy/gcp-deploy.sh deploy/web-entrypoint.sh
./deploy/gcp-bootstrap.sh
```

Save the printed `CLOUD_SQL_CONNECTION` and SQL password.

## 2. ClickHouse Cloud

1. Create a service (AWS/GCP region near you is fine).
2. Create database `marryo` (or use default and set `CLICKHOUSE_DATABASE`).
3. Copy host (no `https://`), user, password.
4. From a machine that can reach ClickHouse:

```bash
export CLICKHOUSE_HOST=....clickhouse.cloud
export CLICKHOUSE_PORT=8443
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=...
export CLICKHOUSE_DATABASE=marryo
npm run db:clickhouse
```

## 3. Secret Manager

Preferred: fill `deploy/env.cloud.local` (from `deploy/env.cloud.example`) then:

```bash
export PROJECT_ID=your-project-id
./deploy/gcp-secrets.sh deploy/env.cloud.local
```

Or create secrets manually:

```bash
# Cloud SQL URL for Cloud Run (unix socket)
# Replace PASSWORD and CONNECTION
echo -n 'postgresql://marryo:PASSWORD@/marryo?host=/cloudsql/PROJECT:REGION:marryo-pg' \
  | gcloud secrets create marryo-database-url --data-file=-

openssl rand -base64 32 | tr -d '\n' | gcloud secrets create marryo-auth-secret --data-file=-
echo -n 'YOUR_GOOGLE_OAUTH_CLIENT_ID' | gcloud secrets create marryo-auth-google-id --data-file=-
echo -n 'YOUR_GOOGLE_OAUTH_CLIENT_SECRET' | gcloud secrets create marryo-auth-google-secret --data-file=-

echo -n 'xxxxx.clickhouse.cloud' | gcloud secrets create marryo-clickhouse-host --data-file=-
echo -n 'default' | gcloud secrets create marryo-clickhouse-user --data-file=-
echo -n 'YOUR_CH_PASSWORD' | gcloud secrets create marryo-clickhouse-password --data-file=-
echo -n 'marryo' | gcloud secrets create marryo-clickhouse-database --data-file=-

# Allow the Cloud Run SA to read them (bootstrap already grants secretAccessor on project)
```

To update a secret later: `gcloud secrets versions add NAME --data-file=-`

## 4. Apply Prisma schema to Cloud SQL

Easiest path — [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy):

```bash
cloud-sql-proxy PROJECT:REGION:marryo-pg &
export DATABASE_URL='postgresql://marryo:PASSWORD@127.0.0.1:5432/marryo'
npx prisma db push --schema prisma/schema.prisma
```

## 5. Build & deploy

```bash
export PROJECT_ID=...
export REGION=asia-southeast1
export CLOUD_SQL_CONNECTION=PROJECT:REGION:marryo-pg
export BUCKET=${PROJECT_ID}-marryo
# defaults already point at custom domains:
#   AUTH_URL=https://marryo.ayusudi.com
#   AGENT_URL=https://ai-marryo.ayusudi.com

./deploy/gcp-deploy.sh
./deploy/gcp-domains.sh   # prints DNS records for ayusudi.com
```

### Custom domains

| Hostname | Cloud Run service | Role |
|----------|-------------------|------|
| `marryo.ayusudi.com` | `marryo-web` | FE + Next.js API (public) |
| `server-marryo.ayusudi.com` | `marryo-web` | Same app (API-style hostname) |
| `ai-marryo.ayusudi.com` | `marryo-agent` | ADK Film Director |

1. Run `./deploy/gcp-domains.sh` after services exist.
2. At your DNS for `ayusudi.com`, add the CNAME/A records that `gcloud` prints.
3. Wait for managed certificate → Active.
4. OAuth redirect URI: `https://marryo.ayusudi.com/api/auth/callback/google`
5. Until DNS is ready, you can temporarily set `AGENT_URL` to the `*.run.app` agent URL.

## 6. Smoke test

```bash
curl -sS "https://marryo.ayusudi.com/api/health"
curl -sS "https://ai-marryo.ayusudi.com/list-apps"
open "https://marryo.ayusudi.com"
```

Sign in with Google → create project → upload ≤6 clips → Direct → soundtrack → grade.

## Local parity (Postgres)

SQLite is retired for Prisma. Locally:

```bash
docker compose up -d postgres
cp .env.example .env   # DATABASE_URL=postgresql://marryo:marryo@127.0.0.1:5432/marryo
npm run db:generate
npx prisma db push --schema prisma/schema.prisma
npm run dev
npm run agent:dev
```

## Cost / sizing notes

| Service | Suggested start |
|---------|-----------------|
| Cloud Run web | 4 Gi / 2 CPU / timeout 900s / concurrency 2 |
| Cloud Run agent | 2 Gi / 2 CPU / timeout 300s |
| Cloud SQL | `db-f1-micro` for demos; bump for real traffic |
| GCS | Standard |
| Vertex | Pay per Gemini token |
| ClickHouse Cloud | Development tier is enough for hackathon |

## Troubleshooting

- **Prisma P1001 / connection** — check Cloud SQL instance attached on the web service and `DATABASE_URL` socket host.
- **GCS 403** — SA needs `roles/storage.objectAdmin` on the bucket/project.
- **Vertex 403** — enable `aiplatform.googleapis.com`; SA needs `roles/aiplatform.user`.
- **OAuth error** — `AUTH_URL` must match the Cloud Run URL; redirect URI must be registered.
- **Out of memory on Direct/render** — raise web memory to 8Gi.
- **Agent ping fails** — web `AGENT_SERVICE_URL` must be the agent Cloud Run URL (no trailing slash issues handled in code).

## Files

- `Dockerfile.web` / `Dockerfile.agent`
- `deploy/gcp-bootstrap.sh` / `deploy/gcp-deploy.sh`
- `deploy/env.cloud.example`
- `docker-compose.yml` (local Postgres)
