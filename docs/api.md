# Marryo API

Phase 6 backend. Interactive docs (Swagger UI):

**http://localhost:3100/api/docs**

Raw OpenAPI: `http://localhost:3100/api/docs/openapi`  
Source of truth: [`docs/openapi.yaml`](openapi.yaml)

Auth: **none** (local only). `owner_id` exists on projects for a later auth phase.

## Storage (Phase 3–6)

| Kind | URI shape |
| --- | --- |
| Raw clip | `gs://{bucket}/projects/{project_id}/raw/{clip_id}.{ext}` |
| Render | `gs://{bucket}/projects/{project_id}/renders/{render_id}.mp4` |
| Identity thumb | `gs://{bucket}/projects/{project_id}/identity/{person_id}/thumb-N.jpg` |
| Local escape hatch | `local:projects/...` when `STORAGE_BACKEND=local` |

Default backend is GCS. Missing bucket/auth → clear `not configured: GCS …` (HTTP 503 on upload). Signed reads are V4 short-TTL URLs; thumbnail route streams private object bytes.

Upload polling: `status=uploading` + `current_stage=upload` during transfer; then `validated` after a successful batch.

## Scene Detection (Phase 4)

`POST /api/projects/:id/detect-scenes` runs shot and scene boundary detection across all valid clips in the project.
- Detector chain: PySceneDetect (`ContentDetector`) → ffmpeg scene filter (`gt(scene,0.4)`) fallback → whole-clip single scene fallback (`[0, duration]`).
- Minimum usable scene duration: `1.5s` (spans shorter than this are merged into neighbors).
- Maximum scenes per clip: capped at `6` (project-wide Gemini budget ≈ `12`).
- Deterministic scene IDs: `scn_{clipId}_{n}` (0-based).
- Upload limit: `MAX_CLIPS_PER_PROJECT=6`.
- Synchronously updates ClickHouse `scenes` table and updates project status/stage to `analysing`.

## Film Director (Phase 5)

`POST /api/projects/:id/direct` runs the hybrid Film Director pipeline:
1. **analyze_clip** — Gemini video understanding per detected scene (no scores)
2. **score_moments** — deterministic theme-weighted scoring (`agent/config/scoring.json`)
3. **query_candidate_moments** — ranked candidates via MCP Toolbox
4. **generate_story** — wedding narrative framework (`agent/config/story_framework.json`)
5. **plan_edit** — EDL assembly from ranked candidates
6. **validate_edl** — forced gate (duration, repetition, variety, ending message)

Persists `EditDecision` in SQLite when valid. Leaves project at `status=directing` / `current_stage=directing` so Phase 6 can render. ADK tools live in `agent/tools/`; orchestrator in `agent/marryo_agent/orchestrator.py`.

Set `MOCK_GEMINI=1` for pipeline tests without Gemini API calls. Set `PIPELINE_USE_GEMINI=1` for real Gemini analysis.

## Render (Phase 6)

`POST /api/projects/:id/render` turns the latest valid EDL into an H.264 MP4:

| Orientation | Canvas |
| --- | --- |
| `landscape` (default) | 1920×1080 |
| `portrait` | 1080×1920 |

Set default on create (`orientation`) or `PATCH /api/projects/:id`. Override per render with `{ "orientation": "portrait" }` — same EDL, new Render row.

Pipeline:
1. Resolve each EDL `moment_id` → ClickHouse `video_moments` (absolute seek = `start_time + clip.start`)
2. Materialize source clips from GCS
3. Render title/ending cards to PNG via Pillow (`agent/cv/textcard_cli.py`)
4. Normalize each scene to the chosen canvas / 30fps (clip audio muted; letterbox/pillarbox)
5. Stitch with `xfade` (concat hard-cut fallback) + silent AAC (`anullsrc` — music seam for later)
6. Evaluate with ffprobe (duration, resolution, codec, audio track, scene coverage)
7. Upload to `projects/{id}/renders/{renderId}.mp4` and persist a `Render` row (with orientation snapshot)

On pass: `status=ready`, `current_stage=soundtrack` (picture locked — choose music next).  
`GET /api/projects/:id/render` returns the latest render + signed `playback_url`.

Grade / card colors: `agent/config/render_presets.json` (keyed by `visual_tone` + `mood`).

### Typography policy

Each render runs a feature-driven typography scorer (`agent/marryo_agent/typography_*.py`):
- Features from EDL moments (emotion/lighting/shot histograms, quality, tempo) + project mood/tone/orientation + name length
- Scores a catalog of OFL fonts / layouts / animations (`agent/config/typography_policy.json`)
- Pillow cards use the winning font, size, position, and colors; FFmpeg applies card motion (`fade_in` / `rise_fade` / `scale_in`)
- Decision JSON is stored on `Render.typography` (font ids, scores, breakdown)

### Soundtrack (Option B — five versions)

After a ready picture render:

1. `POST /api/projects/:id/soundtrack` — scores top 5 Mixkit catalog tracks, remuxes each onto the picture (`-c:v copy`) → **5 playable MP4s**
2. `GET /api/projects/:id/soundtrack` — session + versions + `playback_url` per version (same recommendations for change-song)
3. `POST /api/projects/:id/soundtrack/select` — `{ "mode":"catalog","version_id":"…" }` | `{ "mode":"mute" }` | `{ "mode":"original" }` → `current_stage=grading` (7 choices: 5 scored tracks + mute + original; user must pick)
4. `POST /api/projects/:id/grade/confirm` — end session → `current_stage=complete`; deletes uploads + unused remuxes; retains before/after + selected (`GET /api/projects/:id/archive`)

Picture renders also upload an ungraded twin (`….ungraded.mp4`) for before/after color-grade review.

Catalog: `agent/config/music_catalog.json` + files from `npm run sample:music`.  
Reuse: calling POST again without `{ "force": true }` returns the existing session for the same picture render.

### Finished films + public gallery

Choosing a soundtrack (or mute) upserts a `Film` row (`visibility=private` by default). Storage URI is permanent; APIs mint fresh signed `playback_url`s.

- `GET /api/projects/:id/film` — project’s finished film + signed URL  
- `GET /api/films/public` — `{ films: [...] }` where `visibility=public` (for landing)

Promote for landing (manual DB only):

```sql
UPDATE films SET visibility = 'public' WHERE film_id = 'flm_…';
```

## ClickHouse + MCP

DDL: `npm run db:clickhouse` (`clickhouse/schema.sql` — `scenes`, `video_moments`, `moment_scores`).  
MCP tools: [`mcp/toolbox/README.md`](../mcp/toolbox/README.md) (`query_top_moments`, `query_scenes_for_clip`).

## Quick curl

```bash
# create (optional orientation: landscape | portrait)
curl -s -X POST http://localhost:3100/api/projects \
  -H 'content-type: application/json' \
  -d '{"couple_names":[{"name":"Ada","role":"bride"},{"name":"Alan","role":"groom"}],"mood":"warm","max_duration":90,"orientation":"landscape"}'

# upload
curl -s -X POST "http://localhost:3100/api/projects/$ID/upload" \
  -F "files=@scripts/sample-clips/good-1.mp4" \
  -F "files=@scripts/sample-clips/cuts.mp4" \
  -F "files=@scripts/sample-clips/black.mp4"

# identify faces → person clusters
curl -s -X POST "http://localhost:3100/api/projects/$ID/identify"

# detect scenes (Phase 4)
curl -s -X POST "http://localhost:3100/api/projects/$ID/detect-scenes"

# run Film Director (Phase 5)
curl -s -X POST "http://localhost:3100/api/projects/$ID/direct"

# render MP4 (Phase 6) — uses project.orientation
curl -s -X POST "http://localhost:3100/api/projects/$ID/render"

# re-render as portrait without changing project default
curl -s -X POST "http://localhost:3100/api/projects/$ID/render" \
  -H 'content-type: application/json' \
  -d '{"orientation":"portrait"}'

# change project default format
curl -s -X PATCH "http://localhost:3100/api/projects/$ID" \
  -H 'content-type: application/json' \
  -d '{"orientation":"portrait"}'

# latest render + playback URL
curl -s "http://localhost:3100/api/projects/$ID/render"

# five soundtrack versions (remux onto picture)
curl -s -X POST "http://localhost:3100/api/projects/$ID/soundtrack"
curl -s "http://localhost:3100/api/projects/$ID/soundtrack"
# pick version 1 (use a version_id from the response)
# curl -s -X POST "http://localhost:3100/api/projects/$ID/soundtrack/select" \
#   -H 'content-type: application/json' \
#   -d '{"mode":"catalog","version_id":"stv_…"}'

# status / get / delete
curl -s "http://localhost:3100/api/projects/$ID/status"
curl -s "http://localhost:3100/api/projects/$ID"
curl -s -X DELETE "http://localhost:3100/api/projects/$ID/clips/$CLIP_ID"
```

Pipeline smoke test: `npm run sample:clips && npm run test:pipeline` (with `npm run dev` running).
