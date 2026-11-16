-- Multi-platform publication state lives per draft/platform/account so a
-- retry of one target never re-publishes another. 'unknown' means the remote
-- call was attempted and the outcome is ambiguous: never retry blindly.
-- Safe to run more than once.
BEGIN;
CREATE TABLE IF NOT EXISTS publication_targets (
  id BIGSERIAL PRIMARY KEY,
  draft_id BIGINT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'threads')),
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'publishing', 'published', 'failed', 'blocked', 'shadow', 'unknown')),
  remote_id TEXT,
  container_id TEXT,
  permalink TEXT,
  caption_hash TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (draft_id, platform, account_id)
);
CREATE INDEX IF NOT EXISTS idx_publication_targets_pending
  ON publication_targets (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_publication_targets_draft
  ON publication_targets (draft_id);
COMMIT;
