# Marryo

**You live the moments. We’ll turn them into your story.**

AI pre-wedding **short film** studio. Upload a focused set of clips; Marryo validates them, plans a cut, and delivers a picture-locked film with soundtrack and color grade — without living in a timeline.

Live studio: [https://marryo.ayusudi.com](https://marryo.ayusudi.com) · Agent: [https://ai-marryo.ayusudi.com](https://ai-marryo.ayusudi.com)

Built for the Agentic Cinema hackathon (Google ADK, Gemini, ClickHouse, FFmpeg, Next.js).

## Table of contents

- [What is Marryo](#what-is-marryo)
- [Why you need Marryo](#why-you-need-marryo)
- [Logic](#logic)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Repo layout](#repo-layout)
- [Deploy](#deploy)
- [License](#license)
- [Privacy policy](#privacy-policy)
- [Terms of use](#terms-of-use)
- [Security](#security)

---

## What is Marryo

Marryo is an agentic pre-wedding short-film studio for couples. You upload up to **6** clips; Marryo produces a story cut with soundtrack and color grade — aimed at about a minute after upload on capped footage.

The Film Director (Google ADK + Gemini) plans an **EDL (Edit Decision List)** — a validated JSON cut plan of which moments to use, in what order, and for how long — then FFmpeg renders that plan into a picture-locked MP4 (portrait or landscape).

We built it while preparing for our own wedding: for a digital invitation and as projector décor before guests enter the reception.

---

## Why you need Marryo

Wedding footage is easy to capture and hard to finish. Scrubbing timelines, picking moments, shaping a story, and grading can steal the part of the journey that should feel present.

Marryo is for couples who want:

- A **short film**, not an overnight edit suite session
- An agent that **plans** the cut, with tools that **score, validate, and render** so the result is stitchable
- Authorship after AI — **you** choose soundtrack (catalog / mute / original) and whether to keep the grade
- Something usable for **invites, sharing, or reception playback**

---

## Logic

Studio flow:

1. **Footage** — upload and validate (container, brightness, sharpness, faces); only Kept clips continue  
2. **People** — MediaPipe face clusters; optional bride / groom labels  
3. **Direct** — scenes → ClickHouse moment scores → Film Director drafts & validates an **EDL** → FFmpeg picture lock  
4. **Sound** — top 5 scored catalog tracks, mute, or original  
5. **Grade** — compare before / after; keep grade or skip  
6. **Short film** — preview and download  

![Ingest → Cut → Finish](docs/images/ingest-cut-finish.png)

**Agent plans; tools execute.** Gemini describes moments; deterministic scoring ranks them in ClickHouse; `plan_edit` / `validate_edl` produce a valid EDL; FFmpeg stitches, grades, and remuxes audio.

---

## Architecture

```text
Client (Next.js studio)
  → signed PUT uploads to Cloud Storage
  → Next.js API on Cloud Run (marryo-web)
       → Cloud SQL (Prisma): projects, clips, users, films
       → OpenCV / MediaPipe / PySceneDetect → ClickHouse scenes & moments
       → marryo-agent (Google ADK + Gemini) → scores / EDL plan
       → FFmpeg render + grade → Cloud Storage
  ← signed playback URLs
```

![System architecture](docs/images/architecture.png)

| Path | Role |
|------|------|
| `web/` | Next.js studio UI + API route handlers |
| `services/` | Shared TypeScript (`@marryo/services`): storage, ClickHouse, projects, render |
| `agent/` | Python ADK Film Director + tools |
| `agent/cv/` | Validation, identity, scene detect, text cards (not LLM calls) |
| `mcp/toolbox/` | MCP Database Toolbox config for ClickHouse query tools |

---

## Tech stack

| Layer | Stack |
|-------|--------|
| Studio UI + API | Next.js, React, Tailwind, Auth.js (Google Sign-In) |
| Shared domain | TypeScript (`@marryo/services`), Prisma + Cloud SQL (Postgres) |
| Film Director | Python Google ADK agent + tools |
| Vision / CV | OpenCV, MediaPipe, PySceneDetect, FFmpeg, Pillow |
| Understanding | Gemini via Vertex AI |
| Moment analytics | ClickHouse + MCP Database Toolbox |
| Media | Google Cloud Storage (signed browser uploads) |
| Delivery | FFmpeg (normalize → stitch → grade → soundtrack remux) |
| Soundtrack / type | Mixkit catalog, SIL OFL fonts |
| Hosting | Cloud Run (`marryo-web` + `marryo-agent`), Secret Manager, Artifact Registry, Cloud Build |

More narrative: [`docs/devpost.md`](docs/devpost.md) · API: [`docs/api.md`](docs/api.md)

---

## Getting started

### Prerequisites

- Node.js >= 22.18  
- Python 3.13  
- FFmpeg (`brew install ffmpeg`)  
- Google Cloud CLI (`brew install --cask gcloud-cli`)  
- Optional: [Cloud SQL Auth Proxy](https://cloud.google.com/sql/docs/postgres/connect-auth-proxy) when using Cloud SQL locally  

### Setup

```bash
# 1. Node workspaces
npm install
npm run db:generate
npm run db:push

# 2. Python agent
cd agent
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e .
cd ..

# 3. Env
cp .env.example .env
cp agent/.env.example agent/.env
# fill both in (never commit secrets)

# 4. Sample clips (pipeline tests)
npm run sample:clips

# 5. GCP auth
gcloud init
gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com storage.googleapis.com
```

`GOOGLE_GENAI_USE_VERTEXAI=1` uses Vertex via ADC. Set `0` and use a Google AI Studio `GEMINI_API_KEY` instead if preferred.

### Run

```bash
npm run dev          # studio + API → http://localhost:3100
npm run agent:dev    # ADK agent → http://127.0.0.1:8000
```

Swagger while dev is up: [http://localhost:3100/api/docs](http://localhost:3100/api/docs)

### Checks

```bash
npm run check:env
npm run agent:verify
npm run ping:gemini
npm run ping:clickhouse
npm run db:clickhouse
npm run ping:agent
npm run test:pipeline
npm run test:e2e:install && npm run test:e2e   # needs E2E_AUTH=1
npm run typecheck
```

MCP Toolbox (optional): [`mcp/toolbox/README.md`](mcp/toolbox/README.md)

---

## Repo layout

| Path | What it is |
|------|------------|
| `web/` | Next.js 16 studio + API |
| `services/` | Shared TypeScript modules |
| `agent/` | Python ADK Film Director |
| `agent/tools/` | One file per ADK tool |
| `agent/cv/` | Validation, identity, scene detection, text cards |
| `mcp/toolbox/` | ClickHouse MCP tools config |
| `deploy/` | GCP bootstrap and Cloud Run deploy scripts |
| `docs/` | API docs, Devpost story, diagrams |

---

## Deploy

GCP path: Cloud Run (web + agent) + GCS + Cloud SQL + ClickHouse Cloud + Vertex AI.

See **[deploy/gcp.md](deploy/gcp.md)** — bootstrap, secrets, and `./deploy/gcp-deploy-cloudbuild.sh`.

---

## License

Marryo source code is licensed under the [Apache License 2.0](LICENSE).

Third-party assets keep their own terms:

- Music: [Mixkit Free License](agent/assets/music/README.md)
- Fonts: [SIL Open Font License (OFL)](agent/assets/fonts/README.md)

---

## Privacy policy

**Short version:** Marryo processes wedding footage you upload so we can build your short film. We do not sell your videos.

- **What we collect** — account info from Google sign-in (e.g. name, email), project metadata, and the media you upload.
- **How we use it** — to run the studio pipeline (validate, analyze, score, render, soundtrack, grade) and show you playback URLs.
- **Where it lives** — media in Google Cloud Storage; app data in Cloud SQL; moment analytics in ClickHouse; auth via Auth.js / Google OAuth.
- **Sharing** — media and metadata are processed by our GCP services and Google Gemini/Vertex AI as needed to generate your film. We do not sell personal data.
- **Retention** — user sessions are short-lived: we keep the short film you save for your project, clean up unused remuxes, and do **not** hold onto all uploaded or intermediate videos forever. The only long-lived marketing clips on the landing page are **featured showcase films** — made by Ayu & Fauzan from their own footage, plus open-source [Pixabay](https://pixabay.com/) videos related to couples, weddings, fun, and dates.
- **Contact** — see [Team / LinkedIn](https://www.linkedin.com/in/ayusudi/) for questions.

Full in-app copy: [https://marryo.ayusudi.com/#privacy](https://marryo.ayusudi.com/#privacy)

---

## Terms of use

**Short version:** Marryo is provided as-is for creating your own wedding short films. You must own or have rights to footage you upload.

- You are responsible for the content you upload and for having permission to use it.
- Catalog music and fonts may only be used as allowed by their licenses (inside your exported film; do not redistribute tracks as standalone products).
- Do not abuse the service (malware, unlawful content, scraping others’ private projects).
- Outputs are generated automatically; review your short film before sharing publicly.
- The service may change or be unavailable; we are not liable for lost footage beyond reasonable care of hosted data.
- Continued use means you accept these terms.

Full in-app copy: [https://marryo.ayusudi.com/#terms](https://marryo.ayusudi.com/#terms)

---

## Security

Credentials live only in gitignored `.env` files. Nothing is prefixed with `NEXT_PUBLIC_`, and `services/src/env.ts` refuses to load in a browser bundle, so secrets cannot reach client code.

