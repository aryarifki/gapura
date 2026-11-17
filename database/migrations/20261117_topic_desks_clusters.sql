-- R4: curated desk, discovery metadata and cross-URL event clusters.
-- Idempotent so it can be replayed on restored backups.

ALTER TABLE sources ADD COLUMN IF NOT EXISTS desk varchar(20);

ALTER TABLE topics ADD COLUMN IF NOT EXISTS source_id bigint REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE topics ADD COLUMN IF NOT EXISTS desk varchar(20);
ALTER TABLE topics ADD COLUMN IF NOT EXISTS topic_keywords text[];

UPDATE topics t
SET source_id = r.source_id
FROM raw_items r
WHERE t.raw_item_id = r.id AND t.source_id IS NULL;

CREATE TABLE IF NOT EXISTS topic_clusters (
  id bigserial PRIMARY KEY,
  desk varchar(20) NOT NULL,
  representative_topic_id bigint NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title_key text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT NOW(),
  updated_at timestamp with time zone NOT NULL DEFAULT NOW()
);

ALTER TABLE topics ADD COLUMN IF NOT EXISTS cluster_id bigint REFERENCES topic_clusters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_topics_cluster_id ON topics(cluster_id);
CREATE INDEX IF NOT EXISTS idx_topics_desk_created ON topics(desk, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topic_clusters_desk ON topic_clusters(desk);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sources_desk_check') THEN
    ALTER TABLE sources ADD CONSTRAINT sources_desk_check
      CHECK (desk IS NULL OR desk IN ('politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topics_desk_check') THEN
    ALTER TABLE topics ADD CONSTRAINT topics_desk_check
      CHECK (desk IS NULL OR desk IN ('politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'topic_clusters_desk_check') THEN
    ALTER TABLE topic_clusters ADD CONSTRAINT topic_clusters_desk_check
      CHECK (desk IN ('politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa'));
  END IF;
END $$;
