-- R6: retain the curated editorial input and reviewed original platform text.
-- Historical drafts remain nullable; replaying this migration preserves rows.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS editorial_input JSONB;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS editorial_mode VARCHAR(20);
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS caption_body TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS threads_caption TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS angle TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS scope_note TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS editorial_references JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'drafts'::regclass AND conname = 'drafts_editorial_mode_check'
  ) THEN
    ALTER TABLE drafts ADD CONSTRAINT drafts_editorial_mode_check
      CHECK (editorial_mode IS NULL OR editorial_mode IN ('explainer', 'current'));
  END IF;
END $$;
COMMIT;
