-- Long-form article generated from independent public-web research.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS article_body TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS article_references JSONB;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS article_facts JSONB;
COMMIT;
