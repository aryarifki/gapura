import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterial } from '../material.js';

const articleUrl = 'https://publisher.example.org/news/one';
const input = {
  title: '[Google News: X query fallback] Kebijakan layanan diumumkan - Media Uji',
  url: articleUrl, source: 'Media Uji', type: 'rss', content_kind: 'rss_full',
  content: 'Lembaga menyampaikan kebijakan layanan baru kepada warga. Pelaksanaan tahap pertama berlangsung di tiga wilayah. Jadwal evaluasi dipublikasikan setelah tahap pertama selesai.',
  published_at: '2026-11-16T08:00:00Z', updated_at: '2026-11-16T10:00:00Z',
  image_url: 'https://images.example.org/one.jpg',
};

test('material keeps source body separate from Radar summary and immutable discovery identity', () => {
  const material = createMaterial(input, { retrievedAt: '2026-11-17T00:00:00Z' });
  assert.equal(material.version, 1);
  assert.equal(material.raw_title, input.title);
  assert.equal(material.headline, 'Kebijakan layanan diumumkan');
  assert.equal(material.body, input.content);
  assert.equal(material.discovery_url, articleUrl);
  assert.equal(material.article_url, articleUrl);
  assert.equal(material.published_at, '2026-11-16T08:00:00.000Z');
  assert.equal(material.updated_at, '2026-11-16T10:00:00.000Z');
  assert.equal(material.extraction.kind, 'rss_full');
  assert.equal(material.extraction.status, 'full');
  assert.equal(material.paragraphs.length, 3);
  assert.equal(material.images[0].url, input.image_url);
  assert.ok(material.paragraphs.every((p) => p.source_url === articleUrl));
});

test('feed summaries and search momentum never claim a complete article', () => {
  const discovery = 'https://news.google.com/rss/articles/opaque';
  const material = createMaterial({ ...input, url: discovery, content_kind: 'feed_summary', content: 'Ringkasan pendek.', publisher_url: 'https://publisher.example.org/' });
  assert.equal(material.extraction.status, 'summary_only');
  assert.equal(material.article_url, null);
  assert.equal(material.discovery_url, discovery);
  assert.equal(material.body, 'Ringkasan pendek.');
  assert.equal(material.publisher, 'Media Uji');
  assert.equal(material.paragraphs.length, 1);
});

test('unresolved aggregator failures do not become canonical publisher articles', () => {
  const discovery = 'https://news.google.com/rss/articles/opaque';
  const material = createMaterial({ ...input, url: discovery, type: 'google_news_proxy', content_kind: 'feed_summary' }, {
    document: { canonical_url: discovery, body: '', paragraphs: [], images: [], extraction: { kind: null, status: 'parse_failed', error_code: 'aggregator_unresolved' } },
  });
  assert.equal(material.article_url, null);
  assert.equal(material.discovery_url, discovery);
  assert.equal(material.extraction.error_code, 'aggregator_unresolved');
});

test('article enrichment transfers true article metadata without replacing original feed title/url', () => {
  const document = {
    title: 'Kebijakan layanan di tiga wilayah', publisher: 'Media Uji', canonical_url: articleUrl,
    published_at: '2026-11-16T08:00:00.000Z', updated_at: '2026-11-16T12:00:00.000Z',
    body: input.content, paragraphs: [{ id: 'p1', text: input.content, source_url: articleUrl, role: 'reporting' }],
    images: [{ url: 'https://images.example.org/article.jpg', source_url: articleUrl, credit: 'Media Uji' }],
    extraction: { kind: 'article_html', status: 'full', error_code: null },
  };
  const material = createMaterial({ ...input, url: 'https://news.google.com/rss/articles/opaque' }, { document });
  assert.equal(material.discovery_url, 'https://news.google.com/rss/articles/opaque');
  assert.equal(material.article_url, articleUrl);
  assert.equal(material.raw_title, input.title);
  assert.equal(material.headline, document.title);
  assert.deepEqual(material.images, document.images);
});

test('blocked article extraction retains discovery summary honestly and does not invent body/image', () => {
  const material = createMaterial({ ...input, content_kind: 'feed_summary', content: 'Ringkasan awal.' }, {
    document: { canonical_url: articleUrl, body: '', paragraphs: [], images: [], extraction: { kind: null, status: 'paywall', error_code: 'paywall' } },
  });
  assert.equal(material.extraction.status, 'paywall');
  assert.equal(material.body, '');
  assert.deepEqual(material.paragraphs, []);
  assert.equal(material.discovery_summary, 'Ringkasan awal.');
});

test('malformed dates are null, caller objects are not mutated, and oversized source material is refused', () => {
  const copy = structuredClone(input);
  const material = createMaterial({ ...input, published_at: 'not-a-date', updated_at: null });
  assert.equal(material.published_at, null);
  assert.equal(material.updated_at, null);
  material.images[0].url = 'changed';
  assert.deepEqual(input, copy);
  assert.throws(() => createMaterial({ ...input, content: 'x'.repeat(100001) }), /material_body_too_large/);
});

test('all safe feed image candidates survive regardless of string/object representation', () => {
  const material = createMaterial({ ...input, image_url: null, images: [
    'https://images.example.org/one.jpg',
    { url: 'https://images.example.org/two.jpg', source_url: articleUrl, alt: 'Foto layanan' },
    'https://localhost/private.jpg', 'http://images.example.org/three.jpg',
  ] });
  assert.deepEqual(material.images, [
    { url: 'https://images.example.org/one.jpg', source_url: articleUrl },
    { url: 'https://images.example.org/two.jpg', source_url: articleUrl, alt: 'Foto layanan' },
  ]);
});

test('invalid calendar dates are not silently rolled over into source timestamps', () => {
  for (const value of ['2026-02-30T08:00:00Z', '2026-13-01T00:00:00Z', '1']) {
    const material = createMaterial({ ...input, published_at: value, updated_at: value });
    assert.equal(material.published_at, null, value);
    assert.equal(material.updated_at, null, value);
  }
});

test('feed HTML removes inline and stylesheet-hidden content from both body and paragraphs', () => {
  const material = createMaterial({ ...input, content: 'Visible lead. Hidden material.', content_html: '<style>.secret { display:none }</style><p>Visible lead.</p><div hidden><p>Hidden inline.</p></div><div class="secret"><p>Hidden by stylesheet.</p></div>' });
  assert.equal(material.body, 'Visible lead.');
  assert.deepEqual(material.paragraphs.map((p) => p.text), ['Visible lead.']);
  assert.equal(material.extraction.status, 'partial');
});
