-- Marryo ClickHouse analytics schema (Phase 3).
-- Applied by: npm run db:clickhouse
-- Writers for scenes / moments land in Phase 4-5.
-- Phase 3 only creates tables + sample inserts for MCP proof.

CREATE DATABASE IF NOT EXISTS marryo;

CREATE TABLE IF NOT EXISTS marryo.scenes
(
    scene_id String,
    clip_id String,
    project_id String,
    start_time Float64,
    end_time Float64,
    duration Float64,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (project_id, clip_id, scene_id);

CREATE TABLE IF NOT EXISTS marryo.video_moments
(
    moment_id String,
    scene_id String,
    clip_id String,
    project_id String,
    storage_uri String,
    start_time Float64,
    end_time Float64,
    description String,
    action String,
    emotion String,
    shot_type String,
    lighting String,
    camera_motion String,
    bride_present Bool,
    groom_present Bool,
    other_people Bool,
    visual_quality String,
    duration Float64,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (project_id, clip_id, moment_id);

CREATE TABLE IF NOT EXISTS marryo.moment_scores
(
    moment_id String,
    project_id String,
    quality_score Float64,
    score_breakdown String,
    theme String,
    created_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = MergeTree
ORDER BY (project_id, moment_id);
