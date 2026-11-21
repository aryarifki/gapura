import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverWebTrends, searchPublicWeb } from '../public-web.js';

const now = new Date('2026-11-18T12:00:00Z');
const publicPost = 'https://bsky.app/profile/community.example/post/sample';

test('AI trend selection can use a recent social signal and cannot inject a trend URL or metric', async () => {
  const items = await discoverWebTrends({ now,
    firecrawlKey: '',
    trendsFeed: async () => ({ ok: true, items: [] }),
    fetchImpl: async () => Response.json({ trends: [
      { displayName: 'Pekerja membahas jam kerja', link: '/search?q=jam+kerja', status: 'trending', startedAt: '2026-11-18T00:00:00Z', postCount: 230,
        actors: [{ handle: 'community.example', displayName: 'Forum Pekerja', feed: 'https://bsky.app/profile/community.example/post/sample', text: 'Anggota membahas perubahan jam kerja bagi pekerja.' }] },
      { displayName: 'Tren kedaluwarsa', link: '/search?q=lama', status: 'trending', startedAt: '2026-10-18T00:00:00Z', postCount: 2000, actors: [] },
    ] }),
    choose: async (signals) => {
      assert.equal(signals.length, 1);
      assert.equal(signals[0].engagement.post_count, 230);
      assert.equal(signals[0].social_posts[0].text, 'Anggota membahas perubahan jam kerja bagi pekerja.');
      return [{ signal_id: 32, title: 'Rekaan' }, { signal_id: 1, title: 'Jam kerja menjadi diskusi pekerja', summary: 'Percakapan membahas panjang jam kerja.', url: 'https://invented.example', post_count: 9999 }];
    },
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, publicPost);
  assert.equal(items[0].engagement.post_count, 230);
  assert.equal(items[0].platform, 'public_web');
});

test('public search keeps forum, social and independent web results in the same research pool', async () => {
  const urls = [];
  const results = await searchPublicWeb('jam kerja Indonesia', { firecrawlKey: 'fixture-key', fetchImpl: async (value, options) => {
    const url = new URL(value);
    urls.push(url);
    if (url.hostname === 'api.firecrawl.dev') {
      assert.equal(options.headers.Authorization, 'Bearer fixture-key');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.sources, ['web', 'news']);
      assert.equal(body.limit, 2);
      assert.equal(body.country, 'ID');
      assert.equal(body.scrapeOptions.storeInCache, false);
      return Response.json({ success: true, data: { web: [{ title: 'Buletin pekerja', url: 'https://independent.example/reports/work', markdown: 'Isi buletin komunitas pekerja.' }], news: [] } });
    }
    if (url.hostname === 'api.bsky.app') return Response.json({ posts: [{ uri: 'at://community.example/app.bsky.feed.post/sample', author: { handle: 'community.example' }, record: { text: 'Pengalaman pekerja tentang perubahan jam kerja.' } }] });
    if (url.hostname === 'lemmy.world') return Response.json({ posts: [{ post: { name: 'Diskusi jam kerja', ap_id: 'https://forum.example/post/2', body: '<b>Anggota forum</b> membahas perubahan jadwal.' } }] });
    return new Response('', { status: 503 });
  } });
  assert.deepEqual(new Set(results.map(({ url }) => url)), new Set([publicPost, 'https://forum.example/post/2', 'https://independent.example/reports/work']));
  assert.ok(urls.some((url) => url.searchParams.get('q') === 'jam kerja Indonesia'));
  assert.ok(!JSON.stringify(results).includes('<b>'));
});

test('keyless public search retains social/forum results without calling Firecrawl', async () => {
  const hosts = [];
  const results = await searchPublicWeb('diskusi publik Indonesia', { firecrawlKey: '', fetchImpl: async (value) => {
    const url = new URL(value);
    hosts.push(url.hostname);
    if (url.hostname === 'api.bsky.app') return Response.json({ posts: [
      { uri: 'at://warga.example/app.bsky.feed.post/keyless', author: { handle: 'warga.example' }, record: { text: 'Warga membahas perubahan layanan di forum sosial.' } },
    ] });
    if (url.hostname === 'lemmy.world') return Response.json({ posts: [
      { post: { name: 'Diskusi warga', ap_id: 'https://lemmy.world/post/keyless', body: 'Anggota forum membahas layanan dan pengalaman warga.' } },
    ] });
    return Response.json({ hits: [{ objectID: '42', title: 'Diskusi komunitas' }] });
  } });
  assert.equal(hosts.includes('api.firecrawl.dev'), false);
  assert.ok(results.some(({ kind }) => kind === 'social'));
  assert.ok(results.some(({ kind }) => kind === 'forum'));
});

test('public search issues focused Firecrawl queries and keeps the richest copy of duplicate URLs', async () => {
  const queries = [];
  const url = 'https://news.example.org/one-story';
  const results = await searchPublicWeb('rute bus dialihkan', {
    firecrawlKey: 'fixture-key',
    queries: ['rute bus perbaikan jembatan', 'jadwal bus dan dampak penumpang'], firecrawlLimit: 4,
    fetchImpl: async (value, options = {}) => {
      const target = new URL(value);
      if (target.hostname === 'api.firecrawl.dev') {
        const request = JSON.parse(options.body);
        queries.push(request.query);
        assert.equal(request.limit, 4);
        return Response.json({ success: true, data: { web: [{ title: 'Rute berubah', url, markdown: `Sumber lengkap untuk kueri ${request.query}.` }], news: [] } });
      }
      if (target.hostname === 'api.bsky.app') return Response.json({ posts: [] });
      if (target.hostname === 'lemmy.world') return Response.json({ posts: [] });
      return Response.json({ hits: [] });
    },
  });
  assert.equal(queries.length, 3);
  assert.deepEqual(queries, ['rute bus dialihkan', 'rute bus perbaikan jembatan', 'jadwal bus dan dampak penumpang']);
  const document = results.find((item) => item.url === url);
  assert.ok(document.text.includes('jadwal bus dan dampak penumpang'));
  assert.equal(results.filter((item) => item.url === url).length, 1);
});

test('trend discovery carries the related article title and URL instead of a bare search phrase', async () => {
  const url = 'https://news.example/layanan';
  const items = await discoverWebTrends({ now, firecrawlKey: '',
    fetchImpl: async () => Response.json({ trends: [] }),
    trendsFeed: async () => ({ ok: true, items: [{ title: 'layanan hari ini', pubDate: now.toISOString(),
      extra: { approxTraffic: '1000+', newsItems: [{ title: 'Jadwal layanan warga berubah setelah renovasi', url, source: 'Forum Warga' }] } }] }),
    choose: async (signals) => {
      assert.equal(signals[0].title, 'Jadwal layanan warga berubah setelah renovasi');
      assert.equal(signals[0].url, url);
      return [{ signal_id: signals[0].signal_id, title: signals[0].title, summary: signals[0].summary }];
    },
  });
  assert.equal(items[0].url, url);
  assert.equal(items[0].engagement.traffic_label, '1000+');
});

test('one malformed search URL does not discard valid page content and snippets stay marked', async () => {
  const results = await searchPublicWeb('rute bus', { firecrawlKey: 'fixture-key', fetchImpl: async (value) => {
    if (new URL(value).hostname === 'api.firecrawl.dev') return Response.json({ success: true, data: { web: [
      { url: 'not-a-url', title: 'Broken', markdown: 'invalid result' },
      { url: 'https://news.example/body', markdown: 'Isi artikel sumber yang diambil dari halaman.' },
      { url: 'https://news.example/snippet', description: 'Cuplikan mesin pencari yang perlu diambil dari halaman.' },
    ] } });
    return new Response('', { status: 503 });
  } });
  assert.equal(results.length, 2);
  assert.equal(results.find(({ url }) => url.endsWith('/body')).text_kind, 'page');
  assert.equal(results.find(({ url }) => url.endsWith('/snippet')).text_kind, 'snippet');
});
