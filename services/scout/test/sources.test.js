import test from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { parseFeed } from '../../common/rss.js';
import { cleanText, extractImageUrl, fetchXAccount, fetchXQuery, normalizeArticleUrl, normalizeFeedItem, normalizeXPosts, safeDate, validateSourceType, xHandleFromSource } from '../sources.js';

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
  assert.equal(posts[0].raw_title, 'BI mempertahankan suku bunga');
  assert.equal(posts[0].content_kind, 'x_post');
  assert.equal(posts[0].url, 'https://x.com/bank_indonesia/status/123');
  assert.equal(posts[0].image_url, 'https://pbs.twimg.com/media/example.jpg');
  assert.equal(posts[0].published_at, '2026-11-16T02:00:00.000Z');
});

test('returns no posts for malformed X API payloads', () => {
  assert.deepEqual(normalizeXPosts(null, 'ojkindonesia'), []);
  assert.deepEqual(normalizeXPosts({ data: [{ id: '1', text: '' }] }, 'ojkindonesia'), []);
});

test('X source timestamps use the same strict calendar and timezone validation as feeds', () => {
  for (const value of ['2026-02-30T08:00:00Z', '1', '2026-11-16T08:00:00', 'invalid']) {
    const [post] = normalizeXPosts({ data: [{ id: '1', text: 'Keterangan resmi.', created_at: value }] }, 'media');
    assert.equal(post.published_at, null, value);
  }
  const [valid] = normalizeXPosts({ data: [{ id: '1', text: 'Keterangan resmi.', created_at: '2026-11-16T08:00:00+07:00' }] }, 'media');
  assert.equal(valid.published_at, '2026-11-16T01:00:00.000Z');
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

test('Google News fallback carries its provider type without changing the source title', async () => {
  const feedXml = '<rss><channel><item><title>OJK menerbitkan siaran pers</title><link>https://www.antaranews.com/berita/1</link><pubDate>Mon, 16 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>';
  const posts = await fetchXAccount('@ojk', { token: '', fetchImpl: async () => new Response(feedXml, { status: 200, headers: { 'content-type': 'application/rss+xml' } }) });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'OJK menerbitkan siaran pers');
  assert.equal(posts[0].raw_title, 'OJK menerbitkan siaran pers');
  assert.equal(posts[0].type, 'google_news_proxy');
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
  assert.equal(posts[0].title, 'IHSG ditutup menguat');
});

test('Google News fallback for X search preserves the source title and publisher', async () => {
  const xml = '<rss><channel><item><title>OJK mengumumkan peraturan</title><link>https://news.google.com/item/1</link><source url="https://www.antaranews.com">Antara</source></item></channel></rss>';
  const items = await fetchXQuery('OJK regulasi', { token: '', fetchImpl: async () => new Response(xml, { status: 200 }) });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'OJK mengumumkan peraturan');
  assert.equal(items[0].type, 'google_news_proxy');
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
  assert.equal(posts[0].title, 'OJK aturan');
  assert.equal(posts[0].metrics, undefined);
});

test('normalizes full encoded material without losing the original title or updated date', () => {
  const longBody = `${'Informasi lengkap yang berasal dari feed. '.repeat(70)}Penutup.`;
  const item = normalizeFeedItem({
    title: '[X/RSSHub] Kebijakan baru - Antara', link: 'https://www.antaranews.com/berita/1?utm_source=rss',
    description: 'Ringkasan singkat.', 'content:encoded': `<![CDATA[<p>${longBody}</p><p>Rincian lanjutan.</p>]]>`,
    pubDate: '2026-11-16T09:00:00Z', updated: '2026-11-17T09:00:00Z',
    source: { '#text': 'Antara', '@_url': 'https://www.antaranews.com' },
  });
  assert.equal(item.content, `${longBody} Rincian lanjutan.`);
  assert.equal(item.summary, 'Ringkasan singkat.');
  assert.equal(item.content_kind, 'rss_full');
  assert.match(item.content_html, /<p>Rincian lanjutan\.<\/p>/);
  assert.equal(item.raw_title, '[X/RSSHub] Kebijakan baru - Antara');
  assert.equal(item.title, 'Kebijakan baru');
  assert.equal(item.url, 'https://www.antaranews.com/berita/1');
  assert.equal(item.published_at.toISOString(), '2026-11-16T09:00:00.000Z');
  assert.equal(item.updated_at.toISOString(), '2026-11-17T09:00:00.000Z');
  assert.equal(item.source, 'Antara');
  assert.equal(item.publisher_url, 'https://www.antaranews.com/');
});

test('source dates accept explicit RSS timestamps but reject calendar rollover and ambiguous numeric strings', () => {
  assert.equal(safeDate('Mon, 16 Nov 2026 09:00:00 GMT').toISOString(), '2026-11-16T09:00:00.000Z');
  assert.equal(safeDate('2026-11-16T09:00:00Z').toISOString(), '2026-11-16T09:00:00.000Z');
  for (const value of ['2026-02-30T09:00:00Z', '1', 'yesterday', '2026-11-16T09:00:00', 'not-a-date']) {
    assert.equal(safeDate(value), null, value);
  }
});

test('description-only and previously parsed summaries cannot masquerade as full content', () => {
  const body = 'Ringkasan sumber. '.repeat(90).trim();
  const item = normalizeFeedItem({ title: 'Judul', link: 'https://publisher.example.org/1', description: body, updated: '2026-11-17T09:00:00Z' });
  assert.equal(item.content, body);
  assert.equal(item.summary, body.slice(0, 1000));
  assert.equal(item.content_kind, 'feed_summary');
  assert.equal(item.content_html, '');
  assert.equal(item.published_at, null);
  assert.equal(item.updated_at.toISOString(), '2026-11-17T09:00:00.000Z');
  const [parsed] = parseFeed(`<rss><channel><item><title>Judul</title><link>https://publisher.example.org/1</link><description>${body}</description></item></channel></rss>`);
  const normalized = normalizeFeedItem(parsed);
  assert.equal(normalized.content, body);
  assert.equal(normalized.content_kind, 'feed_summary');
});

test('normalizing parseFeed output does not decode already-clean material a second time', () => {
  const [parsed] = parseFeed('<rss><channel><item><title>Judul</title><link>https://publisher.example.org/1</link><content:encoded><![CDATA[<p>Literal &amp;amp;lt;token&amp;amp;gt;</p>]]></content:encoded></item></channel></rss>');
  const item = normalizeFeedItem(parsed);
  assert.equal(item.content, 'Literal &amp;lt;token&amp;gt;');
  assert.equal(item.summary, 'Literal &amp;lt;token&amp;gt;');
});

test('a supplied content kind does not bypass text cleaning or the summary size guard', () => {
  const base = { title: 'Judul', link: 'https://publisher.example.org/1', content_kind: 'rss_full' };
  const item = normalizeFeedItem({ ...base, content: '<p>Fakta</p><script>ignore()</script>', summary: '<p>Ringkas</p><style>ignore</style>' });
  assert.equal(item.content, 'Fakta');
  assert.equal(item.summary, 'Ringkas');
  assert.throws(() => normalizeFeedItem({ ...base, content: 'Fakta', summary: 'a'.repeat(100_001) }), /feed.*100000|100000.*feed/i);
});

test('normalizes Atom HTML #text and XHTML object bodies from the existing XML parser', () => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  for (const content of [
    '<content type="html">&lt;p&gt;Fakta pertama.&lt;/p&gt;&lt;p&gt;Fakta kedua.&lt;/p&gt;</content>',
    '<content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Fakta pertama.</p><p>Fakta kedua.</p></div></content>',
  ]) {
    const parsed = parser.parse(`<feed><entry><title>Judul - Media Uji</title><link rel="self" href="https://feeds.example.org/1"/><link rel="alternate" href="https://publisher.example.org/1"/>
      <source><title>Media Uji</title><link href="https://publisher.example.org"/></source><summary>Ringkasan.</summary>${content}</entry></feed>`);
    const item = normalizeFeedItem(parsed.feed.entry);
    assert.equal(item.content, 'Fakta pertama. Fakta kedua.');
    assert.equal(item.summary, 'Ringkasan.');
    assert.equal(item.content_kind, 'rss_full');
    assert.match(item.content_html, /<p>Fakta pertama\.<\/p><p>Fakta kedua\.<\/p>/);
    assert.equal(item.title, 'Judul');
    assert.equal(item.source, 'Media Uji');
    assert.equal(item.publisher_url, 'https://publisher.example.org/');
    assert.equal(item.url, 'https://publisher.example.org/1');
  }
});

test('source text cleaning removes script/style contents and never decodes entities twice', () => {
  assert.equal(cleanText('<p>Fakta</p><script>ignore()</script><style>.ignore{}</style>'), 'Fakta');
  assert.equal(cleanText('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  const item = normalizeFeedItem({ title: 'Judul', link: 'https://publisher.example.org/1', content: '<p>Fakta &#x110000;</p><script>ignore()</script>' });
  assert.equal(item.content, 'Fakta �');
  assert.doesNotMatch(item.content_html, /script|ignore\(\)/i);
  assert.equal(normalizeFeedItem({ title: 'Judul', link: 'http://127.0.0.1/1' }), null);
});

test('raw feed title identity is preserved before text and publisher normalization', () => {
  const original = '  Kebijakan &amp; rincian - Antara  ';
  const item = normalizeFeedItem({ title: original, source: 'Antara', link: 'https://publisher.example.org/1' });
  assert.equal(item.raw_title, original);
  assert.equal(item.title, 'Kebijakan & rincian');
});

test('retains full safe image candidates but applies the existing image allowlist to image_url', () => {
  const item = normalizeFeedItem({
    title: 'Judul', link: 'https://img.antaranews.com/berita/1', description: 'Ringkas.',
    'content:encoded': '<p>Laporan.</p><img src="/hero.jpg"><img src="https://cdn.example.org/context.jpg"><img src="javascript:alert(1)">',
    enclosure: { '@_url': 'https://cdn.example.org/audio.mp3', '@_type': 'audio/mpeg' },
  });
  assert.equal(item.image_url, 'https://img.antaranews.com/hero.jpg');
  assert.deepEqual(item.images, ['https://img.antaranews.com/hero.jpg', 'https://cdn.example.org/context.jpg']);
  assert.equal(extractImageUrl({ description: 'Ringkas.', content: { '#text': '<img src="//pbs.twimg.com/media/1.jpg">' }, link: 'https://x.com/media/status/1' }), 'https://pbs.twimg.com/media/1.jpg');
  assert.equal(extractImageUrl({ image_url: 'https://user:pass@pbs.twimg.com/private.jpg' }), null);
  const [parsed] = parseFeed('<rss><channel><item><title>Judul</title><link>https://x.com/media/status/1</link><media:thumbnail url="https://pbs.twimg.com/media/2.jpg"/></item></channel></rss>');
  assert.equal(normalizeFeedItem(parsed).image_url, 'https://pbs.twimg.com/media/2.jpg');
});

test('feed normalization rejects oversized full or summary material rather than truncating it', () => {
  const base = { title: 'Judul', link: 'https://publisher.example.org/1' };
  assert.throws(() => normalizeFeedItem({ ...base, content: 'a'.repeat(100_001) }), /feed.*100000|100000.*feed/i);
  assert.throws(() => normalizeFeedItem({ ...base, description: 'a'.repeat(100_001) }), /feed.*100000|100000.*feed/i);
});

test('RSSHub and Google fallbacks preserve rich body, image and timestamp evidence', async () => {
  const body = 'Materi sumber yang panjang dan lengkap. '.repeat(70).trim();
  const xml = `<rss><channel><item><title>Judul asli - Antara</title><link>https://x.com/media/status/1</link><source url="https://www.antaranews.com">Antara</source>
    <description>Ringkasan sumber.</description><content:encoded><![CDATA[<p>${body}</p><p>Paragraf akhir.</p><img src="https://pbs.twimg.com/media/source.jpg">]]></content:encoded>
    <pubDate>2026-11-16T09:00:00Z</pubDate><updated>2026-11-17T09:00:00Z</updated></item></channel></rss>`;
  for (const load of [fetchXAccount, fetchXQuery]) {
    for (const rssHubBase of ['', 'https://rsshub.example.org']) {
      const items = await load(load === fetchXAccount ? '@ojk' : 'IHSG', { token: '', rssHubBase, fetchImpl: async () => new Response(xml) });
      assert.equal(items[0].title, 'Judul asli');
      assert.equal(items[0].raw_title, 'Judul asli - Antara');
      assert.equal(items[0].content, `${body} Paragraf akhir.`);
      assert.equal(items[0].summary, 'Ringkasan sumber.');
      assert.equal(items[0].content_kind, 'rss_full');
      assert.match(items[0].content_html, /<p>Paragraf akhir\.<\/p>/);
      assert.equal(items[0].image_url, 'https://pbs.twimg.com/media/source.jpg');
      assert.deepEqual(items[0].images, ['https://pbs.twimg.com/media/source.jpg']);
      assert.equal(new Date(items[0].published_at).toISOString(), '2026-11-16T09:00:00.000Z');
      assert.equal(new Date(items[0].updated_at).toISOString(), '2026-11-17T09:00:00.000Z');
      assert.equal(items[0].type, rssHubBase ? 'rsshub' : 'google_news_proxy');
      assert.equal(items[0].metrics, undefined);
    }
  }
});

test('X API material preserves the complete post and all safe attached images', () => {
  const body = `${'Pernyataan sumber resmi. '.repeat(220)}Penutup.`;
  const [post] = normalizeXPosts({
    data: [{ id: '1', text: body, attachments: { media_keys: ['m1', 'm2'] } }],
    includes: { media: [{ media_key: 'm1', url: 'https://pbs.twimg.com/media/1.jpg' }, { media_key: 'm2', url: 'https://pbs.twimg.com/media/2.jpg' }] },
  }, 'media');
  assert.equal(post.content, body);
  assert.equal(post.raw_title, body.slice(0, 280));
  assert.equal(post.title, post.raw_title);
  assert.equal(post.summary, body.slice(0, 1000));
  assert.equal(post.content_kind, 'x_post');
  assert.deepEqual(post.images, ['https://pbs.twimg.com/media/1.jpg', 'https://pbs.twimg.com/media/2.jpg']);
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

test('article URL normalization rejects HTTP instead of silently validating an HTTPS copy', () => {
  assert.equal(normalizeArticleUrl('http://publisher.example.org/article?id=1'), null);
  assert.equal(normalizeFeedItem({ title: 'Insecure item', link: 'http://publisher.example.org/article' }), null);
  assert.equal(normalizeArticleUrl('https://publisher.example.org/article?z=2&utm_source=feed&a=1#details'), 'https://publisher.example.org/article?a=1&z=2');
});
