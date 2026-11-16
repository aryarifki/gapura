import test from 'node:test';
import assert from 'node:assert/strict';
import { loadService, recordingDb } from '../../scout/test/service-harness.js';

const now = new Date().toISOString();
const source = { id: 1, kind: 'news_query', value: 'IHSG', label: 'News', category: 'regulasi', weight: 20, is_active: true, poll_interval_mins: 60 };
function feed(items) {
  return `<rss><channel>${items.map((item) => `<item><title>${item.title}</title><link>${item.url}</link><pubDate>${item.date || now}</pubDate><source url="https://www.kontan.co.id">Kontan</source></item>`).join('')}</channel></rss>`;
}
function database(sources = [source]) {
  return recordingDb((sql, params) => {
    if (sql.includes('SELECT * FROM trend_sources')) {
      const honorsIntervals = sql.includes('poll_interval_mins') && params.includes(false);
      return { rows: sources.filter((row) => (!honorsIntervals || !row.last_scanned_at || Date.now() - Date.parse(row.last_scanned_at) >= row.poll_interval_mins * 60000)
        && (params.length < 2 || row.id === params[1])) };
    }
    if (sql.includes('INSERT INTO trend_items')) return { rows: [{ id: 1, inserted: true }] };
    if (sql.includes('INSERT INTO topic_materials')) return { rows: [{ id: 2, content_hash: 'a'.repeat(64), inserted: true }] };
    return { rows: [] };
  });
}

test('SEO dedup removes tracking and fragments but retains identity query parameters and publisher attribution', async () => {
  const db = database();
  const xml = feed([
    { title: 'IHSG satu', url: 'https://example.org/article?id=1&amp;utm_source=a#detail' },
    { title: 'IHSG dua', url: 'https://example.org/article?id=2' },
    { title: 'IHSG satu lagi', url: 'https://example.org/article?utm_medium=b&amp;id=1' },
  ]);
  const { runSeoScan } = await loadService('seo/seo.js', { client: db, fetchImpl: async () => new Response(xml) });
  await runSeoScan({ client: db });
  const saved = db.calls.filter((call) => call.sql.includes('INSERT INTO trend_items'));
  assert.notEqual(saved[0].params[7], saved[1].params[7]);
  assert.equal(saved[0].params[7], saved[2].params[7]);
  assert.equal(saved[0].params[3], 'Kontan');
  assert.equal(saved[0].params[6], 'https://example.org/article?id=1');
});

test('relevance matches BI and UU only as whole terms and old stories decay even when fetched now', async () => {
  const db = database();
  const xml = feed([
    { title: 'Liburan dan ruuangan bersama keluarga', url: 'https://example.org/1' },
    { title: 'BI menerbitkan UU baru', url: 'https://example.org/2' },
    { title: 'BI menerbitkan UU baru', url: 'https://example.org/3', date: '2001-01-01T00:00:00Z' },
    { title: 'BI menerbitkan UU baru', url: 'https://example.org/4', date: 'invalid' },
  ]);
  const { runSeoScan } = await loadService('seo/seo.js', {
    client: db, config: { scout: { custom_keywords: 'bi,uu' } }, fetchImpl: async () => new Response(xml),
  });
  await runSeoScan({ client: db });
  const saved = db.calls.filter((call) => call.sql.includes('INSERT INTO trend_items'));
  assert.deepEqual(Array.from(saved[0].params[11]), []);
  assert.ok(saved[1].params[11].includes('bi'));
  assert.ok(saved[1].params[11].includes('uu'));
  assert.ok(saved[2].params[9] < 10, 'Old publication must not remain hot after re-fetch');
  assert.equal(saved[3].params[12], null);
});

test('scheduled SEO scans respect intervals while manual source scans force and source requests are bounded', async () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ ...source, id: i + 1, last_scanned_at: now }));
  const db = database(rows);
  let active = 0, peak = 0, requests = 0;
  const { runSeoScan } = await loadService('seo/seo.js', {
    client: db, fetchImpl: async () => {
      requests++;
      peak = Math.max(peak, ++active);
      await new Promise(setImmediate);
      active--;
      return new Response('<rss><channel></channel></rss>');
    },
  });
  const scheduled = await runSeoScan({ client: db });
  assert.equal(scheduled.sources, 0);
  assert.equal(requests, 0);
  const forced = await runSeoScan({ client: db, force: true });
  assert.equal(forced.sources, 7);
  assert.ok(peak > 1 && peak <= 4);
});

test('partial SEO failures have separate source diagnostics and an unsuccessful run status', async () => {
  const db = database([source, { ...source, id: 2, value: 'fail' }]);
  const { runSeoScan } = await loadService('seo/seo.js', {
    client: db, fetchImpl: async (url) => new Response('<rss><channel></channel></rss>', { status: String(url).includes('fail') ? 503 : 200 }),
  });
  const result = await runSeoScan({ client: db });
  assert.equal(result.sourceResults[0].status, 'success');
  assert.equal(result.sourceResults[1].status, 'error');
  assert.equal(result.errors.length, 1);
  const run = db.calls.find((call) => call.sql.includes('INSERT INTO agent_runs'));
  assert.equal(run.params[1], 'error');
});

test('SEO never treats an HTTP 200 HTML error page as a successful empty feed', async () => {
  const db = database();
  const { runSeoScan } = await loadService('seo/seo.js', {
    client: db, fetchImpl: async () => new Response('<html><body>Maintenance</body></html>'),
  });
  const result = await runSeoScan({ client: db });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].error, /RSS|feed/i);
});

test('refetch cannot replace an old published timestamp with a new one', async () => {
  const db = database();
  const query = db.query.bind(db);
  db.query = async (sql, params) => sql.includes('SELECT published_at, first_seen_at')
    ? { rows: [{ published_at: '2001-01-01T00:00:00Z', first_seen_at: '2001-01-01T00:00:00Z' }] }
    : query(sql, params);
  const { runSeoScan } = await loadService('seo/seo.js', {
    client: db, fetchImpl: async () => new Response(feed([{ title: 'IHSG terbaru', url: 'https://example.org/old' }])),
  });
  await runSeoScan({ client: db });
  const saved = db.calls.find((call) => call.sql.includes('INSERT INTO trend_items'));
  assert.equal(saved.params[12].toISOString(), '2001-01-01T00:00:00.000Z');
  assert.ok(saved.params[9] < 10);
});

test('legacy undated stories retain their original observation age when refetched with a new date', async () => {
  const db = database();
  const query = db.query.bind(db);
  db.query = async (sql, params) => sql.includes('SELECT published_at, first_seen_at')
    ? { rows: [{ published_at: null, first_seen_at: null, fetched_at: '2001-01-01T00:00:00Z' }] }
    : query(sql, params);
  const { runSeoScan } = await loadService('seo/seo.js', {
    client: db, fetchImpl: async () => new Response(feed([{ title: 'IHSG terbaru', url: 'https://example.org/old' }])),
  });
  await runSeoScan({ client: db });
  const saved = db.calls.find((call) => call.sql.includes('INSERT INTO trend_items'));
  assert.ok(saved.params[9] < 10);
});

test('manual source scan forces the selected source and promotion retains article and publisher URLs', async () => {
  const db = database([{ ...source, last_scanned_at: now }, { ...source, id: 2, last_scanned_at: now }]);
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.includes('SELECT * FROM trend_items')) return { rows: [{ id: 1, platform: 'news', provider: 'google_news_proxy', title: 'IHSG', author: 'Kontan', url: 'https://news.google.com/rss/articles/one', publisher_url: 'https://www.kontan.co.id/', virality_score: 55 }] };
    if (sql.includes('INSERT INTO topics')) { db.calls.push({ sql, params }); return { rows: [{ id: 17 }] }; }
    return query(sql, params);
  };
  const { runSeoScan, promoteTrendToTopic } = await loadService('seo/seo.js', {
    client: db, fetchImpl: async () => new Response('<rss><channel></channel></rss>'),
  });
  const result = await runSeoScan({ client: db, sourceId: 1 });
  assert.equal(result.sources, 1);
  const promoted = await promoteTrendToTopic(1, db);
  assert.equal(promoted.topic_id, 17);
  const inserted = db.calls.find((call) => call.sql.includes('INSERT INTO topics'));
  assert.equal(inserted.params[2], 'https://news.google.com/rss/articles/one');
  assert.ok(inserted.params.includes('https://www.kontan.co.id/'));
});

test('SEO promotion preserves material metadata and never turns search-volume labels into article prose', async () => {
  const db = database();
  const query = db.query.bind(db);
  const body = 'Lembaga mengumumkan keputusan layanan publik. Tahap pelaksanaan berlaku mulai bulan depan. Evaluasi dijadwalkan setelah pelaksanaan selesai.';
  const material = {
    version: 1, raw_title: 'Berita layanan - Media Uji', headline: 'Berita layanan', provider: 'rss', publisher: 'Media Uji',
    discovery_url: 'https://publisher.example.org/news', article_url: 'https://publisher.example.org/news',
    published_at: '2026-11-16T08:00:00Z', updated_at: '2026-11-16T10:00:00Z', retrieved_at: '2026-11-17T00:00:00Z',
    body, paragraphs: [{ id: 'p1', text: body, source_url: 'https://publisher.example.org/news', role: 'reporting' }], images: [],
    extraction: { kind: 'rss_full', status: 'full', error_code: null },
  };
  db.query = async (sql, params) => {
    if (sql.includes('SELECT * FROM trend_items')) return { rows: [{ id: 1, platform: 'google_trends', provider: 'google_trends', title: 'Berita layanan - Media Uji', snippet: 'Ringkasan berita.', author: 'Media Uji', url: material.discovery_url, virality_score: 55, published_at: material.published_at, engagement: { traffic_label: '200 ribu' }, source_material: material }] };
    if (sql.includes('INSERT INTO topics')) { db.calls.push({ sql, params }); return { rows: [{ id: 17 }] }; }
    if (sql.includes('INSERT INTO topic_materials')) { db.calls.push({ sql, params }); return { rows: [{ id: 2, content_hash: 'a'.repeat(64), inserted: true }] }; }
    return query(sql, params);
  };
  const { promoteTrendToTopic } = await loadService('seo/seo.js', { client: db });
  await promoteTrendToTopic(1, db);
  const topic = db.calls.find((call) => call.sql.includes('INSERT INTO topics'));
  assert.equal(topic.params[0], 'Berita layanan');
  assert.equal(topic.params[1], 'Ringkasan berita.');
  assert.equal(topic.params.some((value) => String(value).includes('Volume pencarian:')), false);
  assert.ok(topic.params.includes(material.published_at));
  assert.ok(db.calls.some((call) => call.sql.includes('INSERT INTO topic_materials')));
});

test('SEO promotion rolls back the topic creation if its material snapshot cannot be saved', async () => {
  const db = database();
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.includes('SELECT * FROM trend_items')) return { rows: [{ id: 1, title: 'Kebijakan warga', snippet: 'Materi awal.', author: 'Media Uji', url: 'https://publisher.example.org/a', virality_score: 50 }] };
    if (sql.includes('INSERT INTO topics')) { db.calls.push({ sql, params }); return { rows: [{ id: 17 }] }; }
    if (sql.includes('INSERT INTO topic_materials')) throw new Error('fixture persistence failed');
    return query(sql, params);
  };
  const { promoteTrendToTopic } = await loadService('seo/seo.js', { client: db });
  await assert.rejects(() => promoteTrendToTopic(1, db), /fixture persistence failed/);
  assert.ok(db.calls.some((call) => call.sql === 'BEGIN'));
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.calls.some((call) => call.sql.includes('UPDATE trend_items SET promoted_topic_id')), false);
});
