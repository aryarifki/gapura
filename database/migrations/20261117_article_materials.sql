-- R2 article material storage. Additive and idempotent: historical rows are
-- retained exactly as observed; nullable columns do not invent old metadata.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS source_material JSONB;
ALTER TABLE trend_items ADD COLUMN IF NOT EXISTS source_material JSONB;

ALTER TABLE topics ADD COLUMN IF NOT EXISTS raw_title TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS normalized_title TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_published_at TIMESTAMPTZ;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS material_status TEXT;

CREATE TABLE IF NOT EXISTS topic_materials (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL,
    material JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (topic_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_topic_materials_latest
    ON topic_materials(topic_id, last_seen_at DESC, id DESC);

COMMIT;
