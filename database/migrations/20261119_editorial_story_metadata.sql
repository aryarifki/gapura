-- Structured article identity, channel glossary and reviewable story sections.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS article_metadata JSONB;
COMMIT;
