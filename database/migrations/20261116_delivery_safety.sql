-- Delivery acknowledgements are distinct from publication confirmation.
-- Apply before deploying publisher/telegram. Safe to run more than once.
BEGIN;
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS telegram_dispatched_at TIMESTAMPTZ;
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS manual_reminded_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_drafts_telegram_pending
  ON drafts (id) WHERE status = 'draft' AND telegram_dispatched_at IS NULL;
COMMIT;
