import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_INPUT_FIELDS,
  containsForbiddenDiscoveryContent,
  inferDesk,
  normalizeDesk,
  projectDiscoveryTopic,
  topicKeywords,
} from '../discovery.js';

const topic = {
  id: 42,
  raw_item_id: 7,
  source_id: 3,
  title: 'IHSG ditutup melemah, saham bank memimpin pelemahan',
  summary: 'SECRET SUMMARY BODY yang tidak boleh masuk payload agen.',
  raw_title: '[Google News: X query fallback] IHSG ditutup melemah - Kontan',
  normalized_title: 'IHSG ditutup melemah',
  url: 'https://www.kontan.co.id/news/ihsg-ditutup-melemah',
  publisher_url: 'https://www.kontan.co.id',
  primary_source: 'Kontan',
  created_at: '2026-11-17T02:30:00.000Z',
  source_published_at: '2026-11-17T01:00:00.000Z',
  desk: null,
  topic_keywords: null,
  image_url: 'https://foto.kontan.co.id/secret.jpg',
  content_raw: '<p>SECRET ARTICLE HTML</p>',
  source_material: { body: 'SECRET MATERIAL BODY', paragraphs: [{ text: 'SECRET PARAGRAPH' }] },
};

test('discovery projection returns exactly the allowlisted input fields', () => {
  const payload = projectDiscoveryTopic(topic);
  assert.deepEqual(Object.keys(payload).sort(), [...DISCOVERY_INPUT_FIELDS].sort());
  assert.equal(payload.source_id, 3);
  assert.equal(payload.source_name, 'Kontan');
  assert.equal(payload.source_url, 'https://www.kontan.co.id/news/ihsg-ditutup-melemah');
  assert.equal(payload.raw_title, '[Google News: X query fallback] IHSG ditutup melemah - Kontan');
  assert.equal(payload.normalized_title, 'IHSG ditutup melemah');
  assert.equal(payload.published_at, '2026-11-17T01:00:00.000Z');
  assert.equal(payload.discovered_at, '2026-11-17T02:30:00.000Z');
  assert.equal(payload.desk, 'bursa');
  assert.ok(Array.isArray(payload.topic_keywords));
  assert.ok(payload.topic_keywords.includes('ihsg'));
});

test('source body, summary, HTML and image URLs never survive projection or serialization', () => {
  const payload = projectDiscoveryTopic(topic);
  assert.deepEqual(containsForbiddenDiscoveryContent(payload), []);
  const serialized = JSON.stringify(payload);
  for (const secret of ['SECRET SUMMARY BODY', 'SECRET ARTICLE HTML', 'SECRET MATERIAL BODY', 'SECRET PARAGRAPH', 'secret.jpg']) {
    assert.ok(!serialized.includes(secret), `payload leaked ${secret}`);
  }
  assert.doesNotMatch(serialized, /"(?:summary|content|body|image_url|images|source_material|publisher_url)"/u);
});

test('an allowlisted-looking topic cannot smuggle nested source material through the projection', () => {
  const payload = projectDiscoveryTopic({ ...topic, extra: { content: 'SECRET NESTED' } });
  assert.equal(Object.hasOwn(payload, 'extra'), false);
  assert.ok(!JSON.stringify(payload).includes('SECRET NESTED'));
});

test('desk inference maps curated source categories and title keywords to the six desks', () => {
  assert.deepEqual([
    inferDesk({ category: 'politik' }),
    inferDesk({ category: 'news_pasar' }),
    inferDesk({ category: 'ojk_regulasi' }),
    inferDesk({ category: 'bi_moneter' }),
    inferDesk({ category: 'jdih_hukum' }),
    inferDesk({ category: 'data_bps' }),
  ], ['politik', 'bursa', 'ekonomi', 'ekonomi', 'hukum', 'ekonomi']);
  const titles = {
    politik: 'DPR dan pemerintah membahas anggaran layanan publik',
    sosial: 'Program pendidikan dan kesehatan diperluas untuk warga',
    hukum: 'Mahkamah Agung membacakan putusan perkara korupsi',
    lingkungan: 'BMKG memperingatkan banjir dan cuaca ekstrem',
    ekonomi: 'BPS melaporkan inflasi dan pertumbuhan ekonomi',
    bursa: 'IHSG ditutup menguat, saham bank memimpin',
  };
  for (const [desk, title] of Object.entries(titles)) assert.equal(inferDesk({ category: 'umum', title }), desk);
  assert.equal(inferDesk({ category: 'umum', title: 'Jadwal acara komunitas pekan ini' }), null);
  assert.equal(normalizeDesk('Politik'), 'politik');
  assert.equal(normalizeDesk('hiburan'), null);
});

test('keyword extraction is deterministic, deduplicated, stopword-free and bounded', () => {
  const keywords = topicKeywords('IHSG ditutup melemah dan saham bank memimpin pelemahan IHSG');
  assert.deepEqual(keywords, ['ihsg', 'ditutup', 'melemah', 'saham', 'bank', 'memimpin', 'pelemahan']);
  assert.ok(keywords.every((word) => !['dan', 'yang', 'untuk', 'dari'].includes(word)));
  assert.equal(new Set(keywords).size, keywords.length);
  assert.ok(keywords.length <= 8);
  assert.deepEqual(topicKeywords('<b>Kebijakan</b> baru &amp; layanan'), ['kebijakan', 'baru', 'layanan']);
  assert.deepEqual(topicKeywords('dan yang untuk dari'), []);
});
