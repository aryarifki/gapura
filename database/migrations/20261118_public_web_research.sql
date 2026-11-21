-- Public-web trend discovery and independent research. No publisher allowlist.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
INSERT INTO trend_sources (kind, value, label, category, weight, poll_interval_mins)
VALUES ('public_web', 'Indonesia topik ramai dibicarakan viral diskusi publik', 'Web publik, forum, sosial & AI trend scan', 'trending', 18, 60)
ON CONFLICT (kind, value) DO UPDATE SET label = EXCLUDED.label, weight = EXCLUDED.weight, poll_interval_mins = EXCLUDED.poll_interval_mins;
COMMIT;
