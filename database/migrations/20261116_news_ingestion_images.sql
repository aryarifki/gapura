-- Add provenance-preserving social ingest and optional editorial image metadata.
ALTER TABLE raw_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS content_format VARCHAR(10) NOT NULL DEFAULT 'carousel';
ALTER TABLE prompt_jobs ADD COLUMN IF NOT EXISTS topic_id BIGINT REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;
ALTER TABLE sources ADD COLUMN IF NOT EXISTS last_error TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'topic_status') THEN
    CREATE TYPE topic_status AS ENUM ('new', 'scored', 'rejected', 'produced', 'archived');
  END IF;
END $$;
