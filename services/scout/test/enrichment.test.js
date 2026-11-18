import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopicMaterialService } from '../enrichment.js';

function fixture({ topic = { id: '7', title: 'Judul Radar', summary: 'Ringkasan pendek.', url: 'https://publisher.example.org/a', primary_source: 'Media Uji' }, stored = null, material } = {}) {
  const calls = [];
  const fetches = [];
  let latest = stored;
  const pool = { async connect() { return { release() {}, async query(sql, params = []) {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT t.*')) return { rows: topic ? [topic] : [] };
    if (sql.includes('SELECT') && sql.includes('FROM topic_materials')) return { rows: latest ? [latest] : [] };
    if (sql.includes('INSERT INTO topic_materials')) {
      latest = { id: '1', content_hash: params[1], material: JSON.parse(params[2]) };
      return { rows: [{ id: '1', content_hash: params[1], inserted: true }] };
    }
    return { rows: [], rowCount: 1 };
  } }; } };
  const reader = { async read(input) { fetches.push(input); return material || {
    title: 'Judul artikel lengkap', publisher: 'Media Uji', canonical_url: topic.url,
    published_at: '2026-11-16T00:00:00.000Z', updated_at: null,
    body: 'Paragraf pertama bahan artikel.\n\nParagraf kedua bahan artikel.\n\nParagraf ketiga bahan artikel.',
    paragraphs: [1, 2, 3].map((id) => ({ id: `p${id}`, text: `Paragraf ${id} bahan artikel.`, source_url: topic.url, role: 'reporting' })),
    images: [], extraction: { kind: 'article_html', status: 'full', error_code: null },
  }; } };
  return { service: createTopicMaterialService({ pool, reader, allowedHosts: new Set(['publisher.example.org', 'news.google.com', 'www.antaranews.com']) }), calls, fetches };
}

test('manual article enrichment saves a snapshot without rewriting discovery evidence or producing drafts', async () => {
  const f = fixture();
  const result = await f.service.enrich(7);
  assert.equal(result.material.extraction.status, 'full');
  assert.equal(result.material.raw_title, 'Judul Radar');
  assert.equal(result.material.headline, 'Judul artikel lengkap');
  assert.equal(f.fetches.length, 1);
  assert.equal(f.fetches[0].url, 'https://publisher.example.org/a');
  assert.ok(f.calls.some(({ sql }) => sql.includes('INSERT INTO topic_materials')));
  assert.ok(!f.calls.some(({ sql }) => /UPDATE topics SET (title|summary)|INSERT INTO drafts|scheduled_posts|publication_targets|verification_reports/u.test(sql)));
});

test('publisher metadata is passed as resolver context, never used as the article target', async () => {
  const topic = { id: '7', title: 'Berita', summary: 'Ringkas.', url: 'https://news.google.com/rss/articles/opaque', primary_source: 'Media Uji', publisher_url: 'https://publisher.example.org/' };
  const f = fixture({ topic });
  await f.service.enrich(7);
  assert.equal(f.fetches[0].url, topic.url);
  assert.equal(f.fetches[0].publisherUrl, topic.publisher_url);
});

test('approved publisher articles receive only a host-mapped content selector', async () => {
  const topic = { id: '7', title: 'Berita Antara', summary: 'Ringkas.', url: 'https://www.antaranews.com/berita/1', primary_source: 'ANTARA' };
  const f = fixture({ topic });
  await f.service.enrich(7);
  assert.deepEqual(f.fetches[0].articleSelectors, ['.wrap__article-detail-content.post-content']);
});

test('unapproved domains fail closed before the reader is called', async () => {
  const f = fixture();
  const denied = createTopicMaterialService({
    pool: { connect: async () => ({ release() {}, query: async (sql) => ({ rows: sql.startsWith('SELECT t.*') ? [{ id: '7', title: 'Judul', url: 'https://publisher.example.org/a', primary_source: 'Media' }] : [] }) }) },
    reader: { read: async () => { throw new Error('must_not_read'); } },
    allowedHosts: new Set(),
  });
  await assert.rejects(denied.enrich(7), /source_material_permission_required/);
  assert.equal(f.fetches.length, 0);
});

test('stored full material is reused without a fresh article request', async () => {
  const stored = { id: '8', content_hash: 'a'.repeat(64), material: { version: 1, extraction: { status: 'full' }, body: 'Cached complete material.' } };
  const f = fixture({ stored });
  const result = await f.service.enrich(7);
  assert.equal(result.id, '8');
  assert.equal(f.fetches.length, 0);
});

test('unknown topics and invalid IDs never trigger a network request or insert', async () => {
  const f = fixture({ topic: null });
  await assert.rejects(() => f.service.enrich(7), /topic_not_found/);
  await assert.rejects(() => f.service.enrich('../bad'), /topic_id_invalid/);
  assert.equal(f.fetches.length, 0);
  assert.equal(f.calls.some(({ sql }) => /INSERT/u.test(sql)), false);
});

test('paywall results retain explicit access status and never substitute summary for body', async () => {
  const f = fixture({ material: { canonical_url: 'https://publisher.example.org/a', body: '', paragraphs: [], images: [], extraction: { kind: null, status: 'paywall', error_code: 'paywall' } } });
  const result = await f.service.enrich(7);
  assert.equal(result.material.extraction.status, 'paywall');
  assert.equal(result.material.body, '');
  assert.equal(result.material.discovery_summary, 'Ringkasan pendek.');
});
