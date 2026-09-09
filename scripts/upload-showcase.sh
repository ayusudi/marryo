#!/usr/bin/env bash
# Upload landing showcase clips to GCS (private objects; landing uses signed URLs).
#
# Expected files in SOURCE_DIR:
#   portrait-01.mp4 … portrait-04.mp4
#   landscape-01.mp4 landscape-02.mp4 landscape-03.mp4
# Optional posters (same basename .jpg); generated with ffmpeg if missing.
#
# Usage:
#   ./scripts/upload-showcase.sh ./path/to/clips
#   BUCKET=marryo-101026-marryo ./scripts/upload-showcase.sh ./path/to/clips
set -euo pipefail

BUCKET="${BUCKET:-marryo-101026-marryo}"
PREFIX="marketing/showcase"
SOURCE_DIR="${1:-.}"

REQUIRED=(
  portrait-01.mp4
  portrait-02.mp4
  portrait-03.mp4
  portrait-04.mp4
  landscape-01.mp4
  landscape-02.mp4
  landscape-03.mp4
)

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "error: source directory not found: ${SOURCE_DIR}" >&2
  exit 1
fi

missing=0
for f in "${REQUIRED[@]}"; do
  if [[ ! -f "${SOURCE_DIR}/${f}" ]]; then
    echo "missing: ${SOURCE_DIR}/${f}" >&2
    missing=1
  fi
done
if [[ "${missing}" -ne 0 ]]; then
  echo "error: provide all 7 MP4s (4 portrait + 3 landscape)" >&2
  exit 1
fi

echo "==> Uploading to gs://${BUCKET}/${PREFIX}/"
for f in "${REQUIRED[@]}"; do
  gcloud storage cp "${SOURCE_DIR}/${f}" "gs://${BUCKET}/${PREFIX}/${f}" \
    --content-type=video/mp4 \
    --cache-control="public, max-age=3600"
  base="${f%.mp4}"
  poster="${SOURCE_DIR}/${base}.jpg"
  if [[ ! -f "${poster}" ]] && command -v ffmpeg >/dev/null 2>&1; then
    echo "  generating poster ${base}.jpg"
    ffmpeg -y -hide_banner -loglevel error -i "${SOURCE_DIR}/${f}" -frames:v 1 -q:v 3 "${poster}"
  fi
  if [[ -f "${poster}" ]]; then
    gcloud storage cp "${poster}" "gs://${BUCKET}/${PREFIX}/${base}.jpg" \
      --content-type=image/jpeg \
      --cache-control="public, max-age=86400"
  fi
done

echo "==> Uploaded (private; use GET /api/showcase for signed playback URLs)"
for f in "${REQUIRED[@]}"; do
  echo "  gs://${BUCKET}/${PREFIX}/${f}"
done
echo "Done. Manifest: web/lib/showcase-clips.ts"
