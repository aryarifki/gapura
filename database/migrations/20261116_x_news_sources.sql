-- Seed first-party X sources for the Scout. Without an X token, the adapter
-- labels RSSHub/Google News fallbacks instead of attributing them to X API.
INSERT INTO sources (name, type, url_or_query, category, poll_interval_mins, is_active)
SELECT seed.name, seed.type, seed.value, seed.category, 15, TRUE
FROM (VALUES
  ('OJK X', 'x_account', '@ojkindonesia', 'ojk_regulasi'),
  ('Bank Indonesia X', 'x_account', '@bank_indonesia', 'bi_moneter'),
  ('BPS X', 'x_account', '@bps_statistics', 'data_bps'),
  ('Kementerian Keuangan X', 'x_account', '@kemenkeuri', 'umum'),
  ('IDX Channel X', 'x_account', '@idx_channel', 'news_pasar'),
  ('Kontan X', 'x_account', '@kontannews', 'news_pasar'),
  ('CNBC Indonesia X', 'x_account', '@cnbcindonesia', 'news_pasar'),
  ('Bisnis Indonesia X', 'x_account', '@bisniscom', 'news_pasar'),
  ('Pencarian X IHSG', 'x_query', 'IHSG OR Bursa Efek Indonesia', 'news_pasar'),
  ('Pencarian X Regulasi', 'x_query', 'OJK OR POJK OR sanksi OJK', 'ojk_regulasi'),
  ('Pencarian X Moneter', 'x_query', 'Bank Indonesia BI-Rate OR rupiah', 'bi_moneter')
) AS seed(name, type, value, category)
WHERE NOT EXISTS (
  SELECT 1 FROM sources existing
  WHERE existing.type = seed.type AND existing.url_or_query = seed.value
);
