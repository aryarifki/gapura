-- ==============================================================================
-- Homeless Media Engine (HME) v2.0 - Database Schema
-- Database Target: hme (Isolated from all existing databases)
-- Owner: hme_user
-- ==============================================================================

-- Pastikan ekstensi aktif
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ENUM Types
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'topic_status') THEN
        CREATE TYPE topic_status AS ENUM ('new', 'scored', 'rejected', 'produced', 'archived');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draft_status') THEN
        CREATE TYPE draft_status AS ENUM ('draft', 'approved', 'scheduled', 'published', 'rejected', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_mode') THEN
        CREATE TYPE post_mode AS ENUM ('auto', 'manual');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'schedule_status') THEN
        CREATE TYPE schedule_status AS ENUM ('pending', 'publishing', 'success', 'failed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_type') THEN
        CREATE TYPE agent_type AS ENUM ('scout', 'analis', 'copywriter', 'designer', 'publisher');
    END IF;
END $$;

-- 1. TABEL SOURCES (Daftar Sumber Niche Scout)
CREATE TABLE IF NOT EXISTS sources (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'rss', 'api', 'scraper'
    url_or_query TEXT NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'data_bps', 'bi_moneter', 'idx_pasar', 'ojk_regulasi', 'jdih_hukum', 'news_pasar'
    poll_interval_mins INT DEFAULT 30,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. TABEL RAW_ITEMS (Bahan Mentah Hasil Polling Scout)
CREATE TABLE IF NOT EXISTS raw_items (
    id BIGSERIAL PRIMARY KEY,
    source_id INT NOT NULL REFERENCES sources(id) ON DELETE RESTRICT,
    url TEXT NOT NULL,
    url_hash CHAR(64) NOT NULL UNIQUE, -- SHA-256 dari URL
    title TEXT NOT NULL,
    content_raw TEXT,
    published_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_raw_items_fetched_at ON raw_items(fetched_at);
CREATE INDEX IF NOT EXISTS idx_raw_items_title_trgm ON raw_items USING gin (title gin_trgm_ops);

-- 3. TABEL TOPICS (Topik Ternormalisasi yang Masuk Pipeline)
CREATE TABLE IF NOT EXISTS topics (
    id BIGSERIAL PRIMARY KEY,
    raw_item_id BIGINT REFERENCES raw_items(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT,
    url TEXT,
    primary_source VARCHAR(100),
    status topic_status DEFAULT 'new',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);

-- 4. TABEL TOPIC_SCORES (Hasil Penilaian Agen Analis 0-100)
CREATE TABLE IF NOT EXISTS topic_scores (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    score_relevance INT NOT NULL CHECK (score_relevance BETWEEN 0 AND 30),
    score_credibility INT NOT NULL CHECK (score_credibility BETWEEN 0 AND 25),
    score_momentum INT NOT NULL CHECK (score_momentum BETWEEN 0 AND 20),
    score_engagement INT NOT NULL CHECK (score_engagement BETWEEN 0 AND 15),
    score_compliance INT NOT NULL CHECK (score_compliance BETWEEN 0 AND 10),
    score_total INT NOT NULL CHECK (score_total BETWEEN 0 AND 100),
    verdict VARCHAR(20) NOT NULL, -- 'passed', 'rejected', 'fast_failed'
    reasoning TEXT,
    model VARCHAR(50) NOT NULL,
    prompt_version VARCHAR(20) DEFAULT 'v1.0',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_topic_scores_topic_id ON topic_scores(topic_id);

-- 5. TABEL DRAFTS (Pusat Keputusan Konten & Carousel Admin)
CREATE TABLE IF NOT EXISTS drafts (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
    slides JSONB NOT NULL, -- Array of slide objects (no, layout, teks, data)
    caption TEXT NOT NULL,
    hashtags TEXT[] DEFAULT '{}',
    disclaimer_type VARCHAR(20), -- 'keuangan', 'hukum', NULL
    status draft_status DEFAULT 'draft',
    needs_review BOOLEAN DEFAULT FALSE,
    tokens_version VARCHAR(50) NOT NULL DEFAULT 'v1.0',
    copy_model VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);

-- 6. TABEL DRAFT_SLIDES (Audit Visual & Riwayat Render per Slide)
CREATE TABLE IF NOT EXISTS draft_slides (
    id BIGSERIAL PRIMARY KEY,
    draft_id BIGINT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
    slide_no INT NOT NULL,
    layout VARCHAR(50) NOT NULL,
    render_path TEXT NOT NULL, -- Path file PNG di storage
    text_snapshot TEXT,
    data_snapshot JSONB,
    rendered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (draft_id, slide_no)
);

-- 7. TABEL TEMPLATES (Pustaka Layout Brand)
CREATE TABLE IF NOT EXISTS templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE, -- 'cover-stat', 'chart-bar', dll.
    tokens_version VARCHAR(50) NOT NULL DEFAULT 'v1.0',
    layout_meta JSONB,
    preview_path TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. TABEL BRAND_SETTINGS (Voice Profile & Aturan Teks)
CREATE TABLE IF NOT EXISTS brand_settings (
    id SERIAL PRIMARY KEY,
    brand_name VARCHAR(100) DEFAULT 'Homeless Media',
    instagram_handle VARCHAR(50) DEFAULT '@homelessmedia',
    voice_examples JSONB NOT NULL DEFAULT '[]', -- Array 5-10 contoh caption terbaik
    signature_words TEXT[] DEFAULT '{}',
    banned_words TEXT[] DEFAULT '{}',
    niche_keywords TEXT[] DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. TABEL SCHEDULED_POSTS (Antrean & Riwayat Eksekusi Publikasi)
CREATE TABLE IF NOT EXISTS scheduled_posts (
    id BIGSERIAL PRIMARY KEY,
    draft_id BIGINT NOT NULL REFERENCES drafts(id) ON DELETE RESTRICT,
    mode post_mode NOT NULL DEFAULT 'auto',
    scheduled_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    status schedule_status DEFAULT 'pending',
    retry_count INT DEFAULT 0,
    ig_creation_id VARCHAR(100),
    ig_media_id VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status, scheduled_at);

-- 10. TABEL AGENT_RUNS (Telemetri Eksekusi Agen AI & Biaya Operasional)
CREATE TABLE IF NOT EXISTS agent_runs (
    id BIGSERIAL PRIMARY KEY,
    agent agent_type NOT NULL,
    entity_id BIGINT, -- ID topik atau draf terkait
    started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMPTZ,
    status VARCHAR(20) NOT NULL, -- 'success', 'error', 'retried'
    model VARCHAR(50) NOT NULL,
    tokens_input INT DEFAULT 0,
    tokens_output INT DEFAULT 0,
    est_cost_idr NUMERIC(10, 2) DEFAULT 0.00,
    error_log TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent, started_at);

-- 11. TABEL AUDIT_LOG (Jejak Append-Only Keputusan Admin)
CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    entity VARCHAR(50) NOT NULL, -- 'draft', 'topic', 'settings', 'token'
    entity_id BIGINT NOT NULL,
    action VARCHAR(50) NOT NULL, -- 'approve', 'reject', 'edit', 'publish'
    actor VARCHAR(50) NOT NULL DEFAULT 'admin',
    payload JSONB, -- Data sebelum/sesudah perubahan
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);

-- 12. TABEL APP_SETTINGS (Konfigurasi Dinamis Aplikasi)
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(50) PRIMARY KEY,
    value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Default Settings (ON CONFLICT DO NOTHING)
INSERT INTO app_settings (key, value, description) VALUES
('score_threshold', '{"min_score": 70, "initial_strict_score": 75}', 'Ambang batas kelulusan topik oleh Analis')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
('publishing_hours_wib', '["07:00", "12:00", "18:00", "21:00"]', 'Jam optimal penayangan konten otomatis')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
('min_post_interval_hours', '3', 'Jarak aman minimal antar publikasi carousel')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
('daily_ai_cost_limit_idr', '15000', 'Batas maksimal pengeluaran token AI harian (Rp)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value, description) VALUES
('telegram_admin_whitelist', '[]', 'Daftar chat_id Telegram yang sah untuk review & command')
ON CONFLICT (key) DO NOTHING;

-- Default Brand Settings
INSERT INTO brand_settings (id, brand_name, instagram_handle, voice_examples, signature_words, banned_words, niche_keywords)
VALUES (
    1,
    'Homeless Media',
    '@homelessmedia',
    '[
      "Badan Pusat Statistik (BPS) merilis data inflasi tahunan...",
      "Bank Indonesia memutuskan mempertahankan BI-Rate di level...",
      "Otoritas Jasa Keuangan (OJK) resmi menerbitkan POJK baru terkait..."
    ]'::jsonb,
    ARRAY['data', 'regulasi', 'bursa', 'fiskal', 'likuiditas', 'moneter'],
    ARRAY['serok', 'to the moon', 'pasti cuan', 'bocoran', 'bandar'],
    ARRAY['IHSG', 'BPS', 'Bank Indonesia', 'OJK', 'POJK', 'Inflasi', 'Dividen', 'APBN']
)
ON CONFLICT (id) DO NOTHING;

-- Sumber Awal Niche Scout
INSERT INTO sources (name, type, url_or_query, category, poll_interval_mins, is_active) VALUES
('BPS Siaran Pers', 'rss', 'https://www.bps.go.id/id/pressrelease.xml', 'data_bps', 30, TRUE),
('Bank Indonesia Siaran Pers', 'rss', 'https://www.bi.go.id/id/rss/Pages/News.aspx', 'bi_moneter', 30, TRUE),
('OJK Siaran Pers', 'rss', 'https://ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Pages/default.aspx', 'ojk_regulasi', 30, TRUE),
('Kontan Investasi & Pasar Modal', 'rss', 'https://investasi.kontan.co.id/rss', 'news_pasar', 30, TRUE),
('Bisnis Indonesia Market', 'rss', 'https://market.bisnis.com/rss', 'news_pasar', 30, TRUE),
('CNBC Indonesia Market', 'rss', 'https://www.cnbcindonesia.com/market/rss', 'news_pasar', 30, TRUE),
('Google News IHSG & Pasar Modal', 'rss', 'https://news.google.com/rss/search?q=IHSG+OR+Bursa+Efek+Indonesia&hl=id&gl=ID&ceid=ID:id', 'news_pasar', 30, TRUE),
('Google News POJK & Regulasi Keuangan', 'rss', 'https://news.google.com/rss/search?q=POJK+OR+Regulasi+OJK&hl=id&gl=ID&ceid=ID:id', 'ojk_regulasi', 30, TRUE)
ON CONFLICT DO NOTHING;

-- ==============================================================================
-- GME v2.1 — Agen SEO (Trending Hunter) & Agen Verifikator
-- Paritas dengan database/migrations/20261111_seo_verifikator.sql
-- ==============================================================================

-- Enum agent_type: tambah 'seo' & 'verifikator' (idempotent, PostgreSQL 12+)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                   WHERE t.typname = 'agent_type' AND e.enumlabel = 'seo') THEN
        ALTER TYPE agent_type ADD VALUE 'seo';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                   WHERE t.typname = 'agent_type' AND e.enumlabel = 'verifikator') THEN
        ALTER TYPE agent_type ADD VALUE 'verifikator';
    END IF;
END $$;

-- Kolom tambahan pada topics
ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) DEFAULT 'rss';
ALTER TABLE topics ADD COLUMN IF NOT EXISTS trend_score INT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS verification_status VARCHAR(30);

-- 13. TREND_SOURCES — Sumber trending yang dapat dikustomisasi admin
CREATE TABLE IF NOT EXISTS trend_sources (
    id SERIAL PRIMARY KEY,
    kind VARCHAR(30) NOT NULL,          -- 'x_account' | 'x_query' | 'google_trends' | 'news_query'
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

-- 14. TREND_ITEMS — Hasil pemindaian Agen SEO
CREATE TABLE IF NOT EXISTS trend_items (
    id BIGSERIAL PRIMARY KEY,
    trend_source_id INT REFERENCES trend_sources(id) ON DELETE SET NULL,
    platform VARCHAR(30) NOT NULL,      -- 'x' | 'google_trends' | 'news'
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

-- 15. VERIFICATION_REPORTS — Laporan verifikasi Agen Verifikator
CREATE TABLE IF NOT EXISTS verification_reports (
    id BIGSERIAL PRIMARY KEY,
    topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,        -- verified | mostly_verified | needs_context | unverified | opinion | speculation | misleading | hoax_detected
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

-- Seed sumber trending awal
INSERT INTO trend_sources (kind, value, label, category, weight) VALUES
('x_account', '@idx_channel', 'IDX Channel (Bursa)', 'pasar_modal', 18),
('x_account', '@ojkindonesia', 'OJK Indonesia (Regulator)', 'regulasi', 20),
('x_account', '@bank_indonesia', 'Bank Indonesia (Moneter)', 'moneter', 20),
('x_account', '@kemenkeuri', 'Kemenkeu RI (Fiskal)', 'fiskal', 18),
('x_account', '@bps_statistics', 'BPS (Data Makro)', 'data_makro', 20),
('x_account', '@kontannews', 'Kontan (Media Pasar)', 'pasar_modal', 12),
('x_account', '@cnbcindonesia', 'CNBC Indonesia (Media Pasar)', 'pasar_modal', 12),
('x_account', '@bisniscom', 'Bisnis Indonesia (Media Pasar)', 'pasar_modal', 12),
('google_trends', 'ID', 'Google Trends Indonesia', 'trending', 10),
('news_query', 'IHSG OR Bursa Efek Indonesia', 'Momentum Berita IHSG', 'pasar_modal', 14),
('news_query', 'OJK OR POJK OR sanksi OJK', 'Momentum Regulasi OJK', 'regulasi', 14),
('news_query', 'Bank Indonesia BI-Rate OR rupiah', 'Momentum Moneter & Rupiah', 'moneter', 14)
ON CONFLICT (kind, value) DO NOTHING;
