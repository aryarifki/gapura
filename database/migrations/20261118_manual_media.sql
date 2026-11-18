-- R7: editor-supplied rasters are immutable assets of their own topic. The AI
-- illustration table keeps its stricter provenance contract; manual uploads
-- carry attribution and a rights basis instead of provider/model metadata.
CREATE TABLE IF NOT EXISTS manual_media_assets (
    id UUID PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'editor_upload' CHECK (kind = 'editor_upload'),
    rights_basis TEXT NOT NULL CHECK (rights_basis IN ('own_work', 'licensed_stock', 'agency_license')),
    credit TEXT NOT NULL CHECK (length(btrim(credit)) BETWEEN 1 AND 200),
    rights_reference TEXT CHECK (rights_reference IS NULL OR length(rights_reference) <= 500),
    local_path TEXT NOT NULL,
    mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
    byte_size INT NOT NULL CHECK (byte_size BETWEEN 1 AND 4194304),
    width INT NOT NULL CHECK (width BETWEEN 320 AND 4096),
    height INT NOT NULL CHECK (height BETWEEN 240 AND 4096),
    sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    original_name TEXT CHECK (original_name IS NULL OR length(original_name) <= 255),
    uploaded_by TEXT NOT NULL DEFAULT 'web_admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS manual_media_assets_topic_history ON manual_media_assets(topic_id, created_at DESC);
