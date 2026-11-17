-- R3: independent immutable illustration versions; historical topics/drafts are unchanged.
CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    kind TEXT NOT NULL DEFAULT 'ai_generated' CHECK (kind = 'ai_generated'),
    rights_basis TEXT NOT NULL DEFAULT 'ai_generated' CHECK (rights_basis = 'ai_generated'),
    credit TEXT NOT NULL DEFAULT 'Gapura Media',
    status TEXT NOT NULL CHECK (status IN ('generating', 'ready', 'failed')),
    selected BOOLEAN NOT NULL DEFAULT FALSE,
    disclosure TEXT NOT NULL DEFAULT 'Ilustrasi AI · Gapura Media' CHECK (disclosure = 'Ilustrasi AI · Gapura Media'),
    disclosure_version INT NOT NULL DEFAULT 1 CHECK (disclosure_version = 1),
    provider TEXT,
    model TEXT,
    model_version TEXT,
    prompt TEXT NOT NULL,
    rights_reference TEXT,
    generation_id TEXT,
    generated_at TIMESTAMPTZ,
    local_path TEXT,
    mime TEXT CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
    byte_size INT CHECK (byte_size BETWEEN 1 AND 4194304),
    width INT CHECK (width BETWEEN 320 AND 4096),
    height INT CHECK (height BETWEEN 240 AND 4096),
    sha256 CHAR(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (topic_id, request_id),
    CHECK (NOT selected OR status = 'ready'),
    CHECK (status <> 'ready' OR (local_path IS NOT NULL AND mime IS NOT NULL AND byte_size IS NOT NULL
        AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL AND provider IS NOT NULL
        AND model IS NOT NULL AND rights_reference IS NOT NULL AND generated_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS media_assets_one_selected ON media_assets(topic_id) WHERE selected;
CREATE INDEX IF NOT EXISTS media_assets_topic_history ON media_assets(topic_id, created_at DESC);

-- A request may reuse an existing immutable asset. Its mapping must survive later selections.
CREATE TABLE IF NOT EXISTS illustration_requests (
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (topic_id, request_id)
);
