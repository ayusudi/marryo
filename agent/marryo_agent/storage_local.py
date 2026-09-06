"""Materialize storage URIs to local paths for CV/Gemini."""

from __future__ import annotations

import hashlib
import os
import subprocess
import tempfile
from pathlib import Path

LOCAL_PREFIX = "local:"


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def uploads_root() -> Path:
    configured = os.environ.get("UPLOADS_DIR", "./uploads")
    p = Path(configured)
    if not p.is_absolute():
        p = repo_root() / configured
    return p.resolve()


def clip_cache_root() -> Path:
    configured = os.environ.get("MARRYO_CLIP_CACHE_ROOT")
    if configured:
        p = Path(configured)
        return p if p.is_absolute() else (repo_root() / configured).resolve()
    return (repo_root() / "tmp" / "marryo-cache").resolve()


def project_cache_dir(project_id: str | None = None) -> Path:
    pid = project_id or os.environ.get("MARRYO_PROJECT_ID", "").strip()
    root = clip_cache_root()
    return root / pid if pid else root


def resolve_gcs_credentials() -> None:
    creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not creds or os.path.isabs(creds):
        return
    resolved = (repo_root() / creds).resolve()
    if resolved.exists():
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(resolved)


def _cache_dest(storage_uri: str, dest_dir: Path) -> Path:
    digest = hashlib.sha1(storage_uri.encode("utf-8")).hexdigest()[:16]
    name = Path(storage_uri.rstrip("/")).name or "clip.mp4"
    suffix = Path(name).suffix or ".mp4"
    return dest_dir / f"{digest}{suffix}"


def materialize_local(storage_uri: str, target_dir: str | None = None) -> str:
    if storage_uri.startswith(LOCAL_PREFIX):
        relative = storage_uri[len(LOCAL_PREFIX) :].lstrip("/")
        return str((uploads_root() / relative).resolve())

    if not storage_uri.startswith("gs://"):
        raise ValueError(f"unsupported storage uri: {storage_uri}")

    # Prefer shared project cache so identify/scenes/direct/render reuse downloads.
    if target_dir:
        dest_dir = Path(target_dir)
    else:
        dest_dir = project_cache_dir()
        if dest_dir == clip_cache_root():
            dest_dir = Path(tempfile.mkdtemp(prefix="marryo-gcs-"))

    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = _cache_dest(storage_uri, dest_dir)
    if dest.is_file() and dest.stat().st_size > 0:
        return str(dest)

    resolve_gcs_credentials()
    from google.cloud import storage

    without = storage_uri[5:]
    bucket_name, _, object_path = without.partition("/")
    client = storage.Client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_path)
    blob.download_to_filename(str(dest))
    return str(dest)


def extract_subclip(source_path: str, start_s: float, end_s: float, out_dir: str) -> str:
    duration = max(0.1, end_s - start_s)
    out_path = os.path.join(out_dir, f"scene_{start_s:.2f}_{end_s:.2f}.mp4")
    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        str(start_s),
        "-i",
        source_path,
        "-t",
        str(duration),
        "-vf",
        "scale='min(1280,iw)':-2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-an",
        out_path,
    ]
    subprocess.run(cmd, check=True)
    return out_path
