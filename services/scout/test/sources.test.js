import test from 'node:test';
import assert from 'node:assert/strict';
import { extractImageUrl, fetchXAccount, fetchXQuery, normalizeXPosts, validateSourceType, xHandleFromSource } from '../sources.js';

test('accepts handles and X profile URLs while rejecting unrelated URLs', () => {
  assert.equal(xHandleFromSource('@ojkindonesia'), 'ojkindonesia');
  assert.equal(xHandleFromSource('https://x.com/bank_indonesia'), 'bank_indonesia');
  assert.equal(xHandleFromSource('https://example.com/news'), null);
  assert.equal(xHandleFromSource('@bad/name'), null);
});

test('validates only implemented RSS and X source formats', () => {
  assert.equal(validateSourceType('x_account', '@ojkindonesia'), null);
  assert.equal(validateSourceType('x_query', 'IHSG lang:id'), null);
  assert.equal(validateSourceType('rss', 'https://example.org/feed.xml'), null);
  assert.match(validateSourceType('x_account', 'https://example.org'), /Akun X harus/);
  assert.match(validateSourceType('api', 'https://example.org/api'), /Tipe sumber tidak didukung/);
});

test('normalizes X posts with canonical URLs, timestamps, and public image URLs', () => {
  const posts = normalizeXPosts({
    data: [{
      id: '123', text: 'BI mempertahankan suku bunga', created_at: '2026-11-16T02:00:00Z',
      attachments: { media_keys: ['m1'] },
    }],
    includes: { media: [{ media_key: 'm1', type: 'photo', url: 'https://pbs.twimg.com/media/example.jpg' }] },
  }, 'bank_indonesia');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'BI mempertahankan suku bunga');
  assert.equal(posts[0].url, 'https://x.com/bank_indonesia/status/123');
  assert.equal(posts[0].image_url, 'https://pbs.twimg.com/media/example.jpg');
  assert.equal(posts[0].published_at, '2026-11-16T02:00:00.000Z');
});

test('returns no posts for malformed X API payloads', () => {
  assert.deepEqual(normalizeXPosts(null, 'ojkindonesia'), []);
  assert.deepEqual(normalizeXPosts({ data: [{ id: '1', text: '' }] }, 'ojkindonesia'), []);
});

test('extracts safe image URLs from RSS media and enclosure variants', () => {
  assert.equal(extractImageUrl({ 'media:content': { '@_url': 'https://pbs.twimg.com/media/a.jpg' } }), 'https://pbs.twimg.com/media/a.jpg');
  assert.equal(extractImageUrl({ enclosure: { '@_url': 'https://pbs.twimg.com/media/b.webp', '@_type': 'image/webp' } }), 'https://pbs.twimg.com/media/b.webp');
  assert.equal(extractImageUrl({ enclosure: { '@_url': 'https://pbs.twimg.com/media/audio.mp3', '@_type': 'audio/mpeg' } }), null);
  assert.equal(extractImageUrl({ image: 'http://127.0.0.1/private.png' }), null);
});

test('fetches an X profile timeline through a mockable API client', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/users/by/username/')) return Response.json({ data: { id: 'u-1' } });
    return Response.json({ data: [{ id: 'p-1', text: 'Kabar kebijakan ekonomi', created_at: '2026-11-16T00:00:00Z' }] });
  };
  const posts = await fetchXAccount('@ojkindonesia', { token: 'test-token', fetchImpl });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/users\/u-1\/tweets/);
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');
  assert.equal(posts[0].url, 'https://x.com/ojkindonesia/status/p-1');
});

test('uses labeled Google News fallback for an X account when the official X token is missing', async () => {
  const feedXml = '<rss><channel><item><title>OJK menerbitkan siaran pers</title><link>https://www.antaranews.com/berita/1</link><pubDate>Mon, 16 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>';
  const posts = await fetchXAccount('@ojk', { token: '', fetchImpl: async () => new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }) });
  assert.equal(posts.length, 1);
  assert.match(posts[0].title, /Google News: X fallback/);
  assert.match(posts[0].url, /antaranews.com/);
});

test('reports actionable errors for invalid accounts, failed fallback, and X provider failures', async () => {
  await assert.rejects(() => fetchXAccount('https://example.org', { token: 'x' }), /Sumber X harus/);
  await assert.rejects(() => fetchXAccount('@ojk', {
    token: 'x', fetchImpl: async () => new Response('{}', { status: 429 }),
  }), /HTTP 429/);
  await assert.rejects(() => fetchXAccount('@ojk', {
    token: '', fetchImpl: async () => new Response('unavailable', { status: 503 }),
  }), /X_BEARER_TOKEN.*fallback RSSHub\/Google News gagal/);
});

test('uses X recent search for configured keyword queries and preserves provider metrics', async () => {
  let requestedUrl = '';
  const posts = await fetchXQuery('IHSG OJK', {
    token: 'test-token',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return Response.json({
        data: [{ id: 'p-2', author_id: 'u-2', text: 'IHSG ditutup menguat', created_at: '2026-11-16T02:00:00Z', public_metrics: { like_count: 12 } }],
        includes: { users: [{ id: 'u-2', username: 'media' }] },
      });
    },
  });
  assert.match(requestedUrl, /tweets\/search\/recent/);
  assert.equal(posts[0].url, 'https://x.com/media/status/p-2');
  assert.equal(posts[0].metrics.like_count, 12);
  assert.match(posts[0].title, /^\[X\]/);
});

test('uses a labeled Google News fallback for X search without a bearer token', async () => {
  const xml = '<rss><channel><item><title>OJK mengumumkan peraturan</title><link>https://news.google.com/item/1</link><source url="https://www.antaranews.com">Antara</source></item></channel></rss>';
  const items = await fetchXQuery('OJK regulasi', { token: '', fetchImpl: async () => new Response(xml, { status: 200 }) });
  assert.equal(items.length, 1);
  assert.match(items[0].title, /Google News: X query fallback/);
  assert.equal(items[0].source, 'Antara');
});

test('rejects malformed X searches before any external request', async () => {
  let called = false;
  await assert.rejects(() => fetchXQuery('x', { token: 't', fetchImpl: async () => { called = true; } }), /Query X tidak valid/);
  assert.equal(called, false);
});

test('Google News fallback preserves distinct article URLs and separate publisher metadata', async () => {
  const xml = `<rss><channel>${['one', 'two'].map((id) => `<item><title>OJK ${id}</title><link>https://news.google.com/rss/articles/${id}</link><source url="https://www.antaranews.com">Antara</source></item>`).join('')}</channel></rss>`;
  const items = await fetchXQuery('OJK regulasi', { token: '', rssHubBase: '', fetchImpl: async () => new Response(xml) });
  assert.equal(items[0].url, 'https://news.google.com/rss/articles/one');
  assert.equal(items[1].url, 'https://news.google.com/rss/articles/two');
  assert.equal(items[0].publisher_url, 'https://www.antaranews.com/');
  assert.deepEqual(items[0].metrics, undefined);
});

test('malformed posts do not shift API metrics or authors onto the wrong post', async () => {
  const posts = await fetchXQuery('IHSG', {
    token: 'fixture', fetchImpl: async () => Response.json({
      data: [{ id: 'bad', text: '' }, { id: 'good', author_id: 'u2', text: 'IHSG', public_metrics: { like_count: 7 } }],
      includes: { users: [{ id: 'u2', username: 'publisher' }] },
    }),
  });
  assert.equal(posts[0].url, 'https://x.com/publisher/status/good');
  assert.equal(posts[0].metrics.like_count, 7);
});

test('X query uses configured RSSHub search fallback without inventing engagement', async () => {
  const calls = [];
  const posts = await fetchXQuery('IHSG', {
    token: '', rssHubBase: 'https://rsshub.example.org', fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response('<rss><channel><item><title>IHSG</title><link>https://x.com/media/status/12</link></item></channel></rss>');
    },
  });
  assert.match(calls[0], /^https:\/\/rsshub.example.org\/twitter\/keyword\/IHSG/);
  assert.equal(posts[0].type, 'rsshub');
  assert.equal(posts[0].metrics, undefined);
});

test('an unavailable configured X API falls back to RSSHub with an honest provider label', async () => {
  const requests = [];
  const posts = await fetchXAccount('@ojk', {
    token: 'fixture-key', rssHubBase: 'https://rsshub.example.org', fetchImpl: async (url) => {
      requests.push(String(url));
      if (String(url).includes('api.twitter.com')) return new Response('{}', { status: 429 });
      return new Response('<rss><channel><item><title>OJK aturan</title><link>https://x.com/ojk/status/1</link></item></channel></rss>');
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(posts[0].type, 'rsshub');
  assert.match(posts[0].title, /RSSHub/);
  assert.equal(posts[0].metrics, undefined);
});

test('an HTML page cannot silently count as a successful X news fallback', async () => {
  await assert.rejects(() => fetchXQuery('IHSG', {
    token: '', rssHubBase: '', fetchImpl: async () => new Response('<html>maintenance</html>'),
  }), /fallback.*gagal/i);
});

test('a network failure on configured X search still reaches the labeled news fallback', async () => {
  const posts = await fetchXQuery('IHSG', {
    token: 'fixture-key', rssHubBase: '', fetchImpl: async (url) => {
      if (String(url).includes('api.twitter.com')) throw new Error('network unavailable');
      return new Response('<rss><channel><item><title>IHSG</title><link>https://news.google.com/rss/articles/1</link></item></channel></rss>');
    },
  });
  assert.equal(posts[0].type, 'google_news_proxy');
  assert.equal(posts[0].metrics, undefined);
});
