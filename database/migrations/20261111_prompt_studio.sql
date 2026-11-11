-- ==============================================================================
-- GME v2.2 Migration: Studio Prompt (prompt-driven production)
-- File: database/migrations/20261111_prompt_studio.sql
-- Idempotent (aman dijalankan berulang).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 17. PROMPT_JOBS — Antrian produksi dari prompt admin.
--     status: queued|planning|plan_review|drafting|verifying|rendering|
--             dispatching|review|scheduled|published|failed|cancelled
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS prompt_jobs (
    id BIGSERIAL PRIMARY KEY,
    prompt TEXT NOT NULL,
    mode VARCHAR(20) NOT NULL DEFAULT 'full',
    plan JSONB,
    topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL,
    draft_id BIGINT REFERENCES drafts(id) ON DELETE SET NULL,
    verification_id BIGINT,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    current_step VARCHAR(30),
    progress INT NOT NULL DEFAULT 0,
    llm_calls INT NOT NULL DEFAULT 0,
    error TEXT,
    actor VARCHAR(50) NOT NULL DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_prompt_jobs_status ON prompt_jobs(status, id);
CREATE INDEX IF NOT EXISTS idx_prompt_jobs_draft ON prompt_jobs(draft_id);

-- ------------------------------------------------------------------------------
-- 18. JOB_LOGS — Log per langkah eksekusi job (sumber progress UI).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_logs (
    id BIGSERIAL PRIMARY KEY,
    job_id BIGINT NOT NULL REFERENCES prompt_jobs(id) ON DELETE CASCADE,
    step VARCHAR(30) NOT NULL,
    level VARCHAR(10) NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id, id);

-- ------------------------------------------------------------------------------
-- 19. LLM_USAGE — Pemakaian token per panggilan LLM (biaya nyata).
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS llm_usage (
    id BIGSERIAL PRIMARY KEY,
    agent VARCHAR(30) NOT NULL,
    provider VARCHAR(30) NOT NULL,
    model VARCHAR(60) NOT NULL,
    prompt_tokens INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    job_id BIGINT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at);

-- Registrasi agen studio pada enum agent_type
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_type') THEN
        CREATE TYPE agent_type AS ENUM ('scout', 'analis', 'copywriter', 'designer', 'publisher');
    END IF;
    ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'seo';
    ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'verifikator';
    ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'studio';
EXCEPTION
    WHEN invalid_parameter_value THEN NULL; -- value sudah ada
END $$;
