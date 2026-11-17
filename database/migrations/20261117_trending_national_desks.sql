-- Add discovery queries across the six national desks without rewriting legacy
-- sources, their activation state, stored stories, or editorial decisions.
-- Running this seed again preserves operator edits to existing entries.
BEGIN;
INSERT INTO trend_sources (kind, value, label, category, weight, poll_interval_mins, is_active) VALUES
  ('news_query', 'Indonesia (DPR OR pemilu OR kebijakan pemerintah)', 'Desk Gapura: Politik', 'politik', 18, 60, TRUE),
  ('news_query', 'Indonesia (layanan publik OR pendidikan OR kesehatan OR ketenagakerjaan)', 'Desk Gapura: Sosial', 'sosial', 18, 60, TRUE),
  ('news_query', 'Indonesia (putusan pengadilan OR Mahkamah Konstitusi OR KPK OR hak warga)', 'Desk Gapura: Hukum', 'hukum', 18, 60, TRUE),
  ('news_query', 'Indonesia (iklim OR polusi OR kehutanan OR bencana OR transisi energi)', 'Desk Gapura: Lingkungan', 'lingkungan', 18, 60, TRUE),
  ('news_query', 'Indonesia (APBN OR inflasi OR industri OR harga pangan OR perdagangan)', 'Desk Gapura: Ekonomi Nasional', 'ekonomi', 18, 60, TRUE),
  ('news_query', 'Indonesia (Bursa Efek Indonesia OR keterbukaan emiten OR aksi korporasi)', 'Desk Gapura: Bursa Saham', 'bursa', 18, 60, TRUE)
ON CONFLICT (kind, value) DO NOTHING;
COMMIT;
