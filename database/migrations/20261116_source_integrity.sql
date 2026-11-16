-- Source provenance, scan diagnostics and configurable scoring integrity.
-- Apply after 20261111_seo_verifikator.sql and 20261116_news_ingestion_images.sql.
-- This migration is intentionally schema-only: it never rewrites historical items,
-- hashes, verdicts, or scores. Existing invalid score totals must be reviewed before
-- VALIDATE CONSTRAINT topic_scores_component_total; NOT VALID still checks new rows.
BEGIN;

ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_scan_diagnostics JSONB;
ALTER TABLE trend_sources ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMPTZ;
ALTER TABLE trend_sources ADD COLUMN IF NOT EXISTS last_scan_diagnostics JSONB;
ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS publisher_url TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS publisher_url TEXT;
ALTER TABLE trend_items ADD COLUMN IF NOT EXISTS publisher_url TEXT;
-- Nullable for pre-migration rows; fetched_at is a conservative historical fallback.
-- New inserts retain their first observation independently of later fetches.
ALTER TABLE trend_items ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ;
ALTER TABLE trend_items ALTER COLUMN first_seen_at SET DEFAULT CURRENT_TIMESTAMP;

-- UI weights are nonnegative integers totaling 100. Per-config bounds and exact
-- totals are validated by Analis before any status transition. DB components must
-- therefore permit the full configured range instead of legacy fixed weights.
ALTER TABLE topic_scores DROP CONSTRAINT IF EXISTS topic_scores_score_relevance_check;
ALTER TABLE topic_scores DROP CONSTRAINT IF EXISTS topic_scores_score_credibility_check;
ALTER TABLE topic_scores DROP CONSTRAINT IF EXISTS topic_scores_score_momentum_check;
ALTER TABLE topic_scores DROP CONSTRAINT IF EXISTS topic_scores_score_engagement_check;
ALTER TABLE topic_scores DROP CONSTRAINT IF EXISTS topic_scores_score_compliance_check;
ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_score_relevance_check CHECK (score_relevance BETWEEN 0 AND 100);
ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_score_credibility_check CHECK (score_credibility BETWEEN 0 AND 100);
ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_score_momentum_check CHECK (score_momentum BETWEEN 0 AND 100);
ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_score_engagement_check CHECK (score_engagement BETWEEN 0 AND 100);
ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_score_compliance_check CHECK (score_compliance BETWEEN 0 AND 100);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'topic_scores'::regclass AND conname = 'topic_scores_component_total') THEN
    ALTER TABLE topic_scores ADD CONSTRAINT topic_scores_component_total
      CHECK (score_total = score_relevance + score_credibility + score_momentum + score_engagement + score_compliance) NOT VALID;
  END IF;
END $$;

COMMIT;
