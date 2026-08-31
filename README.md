# Marryo

AI-powered pre-wedding film director. Upload wedding footage, and an agent validates it,
understands the scenes, and cuts a highlight film.

Built for the Agentic Cinema hackathon on Google ADK / Agent Engine, Gemini, ClickHouse,
FFmpeg and Next.js.

> Phase 0: environment scaffolding only. There is no product functionality yet.

## Layout

| Path         | What it is                                                                 |
| ------------ | -------------------------------------------------------------------------- |
| `web/`       | Next.js 16 API layer (route handlers only, no frontend pages yet)          |
| `services/`  | Shared TypeScript modules (`@marryo/services`): env, storage, clickhouse, projects |
| `agent/`     | Python ADK agent (the Film Director) and its tools                          |
| `agent/tools/` | One file per ADK tool function                                            |
| `agent/cv/`  | Validation, identity clustering, scene detection (plain Python, not LLM calls) |
| `scripts/`   | CLI scripts for exercising the backend without a UI                         |

The Next.js API layer calls the ADK agent over HTTP. ADK is Python-native and is not
reimplemented in TypeScript.

## Prerequisites

- Node.js >= 22.18 (TypeScript files are run directly via Node's type stripping)
- Python 3.13
- FFmpeg (`brew install ffmpeg`)
- Google Cloud CLI (`brew install --cask gcloud-cli`)

## Setup

```bash
# 1. Node workspaces
npm install

# 2. Python agent environment
cd agent
python3.13 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pip install -e .
cd ..

# 3. Environment variables
cp .env.example .env
cp agent/.env.example agent/.env
# then fill both in

# 4. Google Cloud auth (interactive, opens a browser)
gcloud init
gcloud auth application-default login
gcloud services enable aiplatform.googleapis.com storage.googleapis.com
```

`GOOGLE_GENAI_USE_VERTEXAI=1` uses Vertex AI via your gcloud credentials. Set it to `0` to
use a Google AI Studio `GEMINI_API_KEY` instead.

## Running

```bash
npm run dev          # Next.js API layer on http://localhost:3100
npm run agent:dev    # ADK dev server on http://127.0.0.1:8000
```

Port 3100 rather than the Next.js default of 3000, which is already taken on this machine.

## Checks

```bash
npm run check:env        # required env vars present (prints names, never values)
npm run agent:verify     # opencv, mediapipe, scenedetect, ffmpeg, ADK all import/run
npm run ping:gemini      # one round-trip to Gemini
npm run ping:clickhouse  # SELECT 1
npm run ping:agent       # Next.js API route -> ADK dev server
npm run typecheck
```

## Security

Credentials live only in `.env` files, which are gitignored. Nothing is prefixed with
`NEXT_PUBLIC_`, and `services/src/env.ts` refuses to load in a browser bundle, so secrets
cannot reach client code.
