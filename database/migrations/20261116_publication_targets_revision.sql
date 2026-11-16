-- Bind each target to the operator-approved schedule and retain the point at
-- which publication became irreversible. Safe to run more than once.
BEGIN;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS schedule_id BIGINT REFERENCES scheduled_posts(id);
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE publication_targets ADD COLUMN IF NOT EXISTS publish_attempted_at TIMESTAMPTZ;
COMMIT;
