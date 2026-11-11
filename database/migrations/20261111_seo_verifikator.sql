-- ==============================================================================
-- GME v2.1 Migration: Agen SEO (Trending Hunter) + Agen Verifikator
-- File: database/migrations/20261111_seo_verifikator.sql
-- Idempotent (aman dijalankan berulang).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 13. TREND_SOURCES — Sumber trending yang bisa dikustomisasi admin
--     kind: 'x_account' | 'x_query' | 'google_trends' | 'news_query'
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trend_sources (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(30) NOT NULL,
    value VARCHAR(255) NOT NULL,
    label VARCHAR(150),
    category VARCHAR(50) DEFAULT 'trending',
    weight INT DEFAULT 10,
    poll_interval_mins INT DEFAULT 60,
    is_active BOOLEAN DEFAULT TRUE,
    last_scanned_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (kind, value)
);

-- ------------------------------------------------------------------------------
-- 14. TREND_ITEMS — Hasil pemindaian Agen SEO (X, Google Trends, momentum berita)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trend_items (
    id BIGSERIAL PRIMARY KEY,
    trend_source_id INT REFERENCES trend_sources(id) ON DELETE SET NULL,
    platform VARCHAR(30) NOT NULL,
    provider VARCHAR(40) NOT NULL,
    author VARCHAR(150),
    title TEXT NOT NULL,
    snippet TEXT,
    url TEXT,
    url_hash CHAR(64),
    engagement JSONB DEFAULT '{}'::jsonb,
    virality_score INT DEFAULT 0,
    score_breakdown JSONB DEFAULT '{}'::jsonb,
    matched_keywords TEXT[] DEFAULT '{}',
    ai_analysis JSONB,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    promoted_topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_trend_items_hash ON trend_items(url_hash) WHERE url_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trend_items_score ON trend_items(virality_score DESC, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_items_platform ON trend_items(platform, fetched_at DESC);

-- ------------------------------------------------------------------------------
-- 15. VERIFICATION_REPORTS — Laporan verifikasi Agen Verifikator
-- status: verified | mostly_verified | needs_context | unverified |
--         opinion | speculation | misleading | hoax_detected
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_reports (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    confidence INT NOT NULL DEFAULT 0,
    source_tier VARCHAR(20),
    corroboration JSONB DEFAULT '{}'::jsonb,
    claims JSONB DEFAULT '[]'::jsonb,
    misconceptions JSONB DEFAULT '[]'::jsonb,
    red_flags JSONB DEFAULT '[]'::jsonb,
    summary TEXT,
    deep_explanation TEXT,
    reader_takeaway TEXT,
    disclaimer TEXT,
    model VARCHAR(80),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_verification_topic ON verification_reports(topic_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 16. Kolom tambahan pada topics (asal-usul & status verifikasi)
-- ------------------------------------------------------------------------------
ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) DEFAULT 'feed';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS trend_score INT DEFAULT 0;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30);

-- ------------------------------------------------------------------------------
-- 17. Telemetri agen baru pada agent_runs (enum diperluas)
-- ------------------------------------------------------------------------------
DO $$ BEGIN
    ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'seo';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
    ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'verifikator';
EXCEPTION WHEN others THEN NULL; END $$;

-- ------------------------------------------------------------------------------
-- 18. Seed sumber trending default (dapat diubah/dinonaktifkan dari dashboard)
-- ------------------------------------------------------------------------------
INSERT INTO trend_sources (kind, value, label, category, weight) VALUES
  ('x_account', '@idx_channel',     'IDX Channel (Bursa)',            'pasar_modal', 18),
  ('x_account', '@ojkindonesia',    'OJK Indonesia (Regulator)',      'regulasi',    20),
  ('x_account', '@bank_indonesia',  'Bank Indonesia (Moneter)',       'moneter',     20),
  ('x_account', '@kemenkeuri',      'Kemenkeu RI (Fiskal)',           'fiskal',      18),
  ('x_account', '@bps_statistics',  'BPS (Data Makro)',               'data_makro',  20),
  ('x_account', '@kontannews',      'Kontan (Media Pasar)',           'pasar_modal', 12),
  ('x_account', '@cnbcindonesia',   'CNBC Indonesia (Media Pasar)',   'pasar_modal', 12),
  ('x_account', '@bisniscom',       'Bisnis Indonesia (Media Pasar)', 'pasar_modal', 12),
  ('google_trends', 'ID',           'Google Trends Indonesia',        'trending',    10),
  ('news_query', 'IHSG OR Bursa Efek Indonesia',   'Momentum Berita IHSG',       'pasar_modal', 14),
  ('news_query', 'OJK OR POJK OR sanksi OJK',      'Momentum Regulasi OJK',      'regulasi',    14),
  ('news_query', 'Bank Indonesia BI-Rate OR rupiah','Momentum Moneter & Rupiah',  'moneter',     14)
ON CONFLICT (kind, value) DO NOTHING;
