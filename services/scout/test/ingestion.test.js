import test from 'node:test';
import assert from 'node:assert/strict';
import { loadService, recordingDb } from './service-harness.js';

const sources = [
  { id: 1, name: 'News radar', type: 'rss', url_or_query: 'https://news.google.com/rss/search?q=ihsg' },
  { id: 2, name: 'Broken feed', type: 'rss', url_or_query: 'https://example.org/broken' },
];
const feed = `<rss><channel>
  <item><title>IHSG sesi pertama</title><link>https://news.google.com/rss/articles/one?utm_source=rss</link><source url="https://www.kontan.co.id">Kontan</source><pubDate>invalid-date</pubDate><description>Data pasar</description></item>
  <item><title>IHSG sesi kedua</title><link>https://news.google.com/rss/articles/two</link><source url="https://www.kontan.co.id">Kontan</source><pubDate>2026-11-16T02:00:00Z</pubDate></item>
  <item><title>IHSG sesi ketiga</title><link>https://news.google.com/rss/articles/three</link></item>
</channel></rss>`;

function scoutDb(rows = sources) {
  let id = 0;
  return recordingDb((sql) => {
    if (sql.includes('SELECT * FROM sources')) return { rows };
    if (sql.includes('INSERT INTO raw_items')) return { rows: [{ id: ++id }] };
    return { rows: [] };
  });
}

test('ingest honors configured limits and dedup, keeps article URLs and publisher attribution, and isolates failed feeds', async () => {
  const db = scoutDb();
  const { runScout } = await loadService('scout/scout.js', {
    client: db, config: { scout: { max_items_per_source: 2, dedup_similarity_threshold: 0.91 } },
    fetchImpl: async (url) => new Response(url.includes('broken') ? 'down' : feed, { status: url.includes('broken') ? 503 : 200 }),
  });
  const result = await runScout();
  assert.equal(result.totalNew, 2);
  const raw = db.calls.filter((call) => call.sql.includes('INSERT INTO raw_items'));
  assert.equal(raw[0].params[1], 'https://news.google.com/rss/articles/one');
  assert.equal(raw[0].params[5], null);
  assert.notEqual(raw[0].params[2], raw[1].params[2]);
  const topics = db.calls.filter((call) => call.sql.includes('INSERT INTO topics'));
  assert.equal(topics[0].params[4], 'Kontan');
  assert.ok(topics[0].params.includes('https://www.kontan.co.id/'));
  const dedup = db.calls.filter((call) => call.sql.includes('similarity('));
  assert.ok(dedup.every((call) => call.params[1] === 0.91));
  assert.equal(result.sourceResults[0].inserted, 2);
  assert.equal(result.sourceResults[1].status, 'error');
  assert.match(result.sourceResults[1].error, /503/);
});

test('Atom links, malformed items and source processing failures do not block other sources', async () => {
  const db = scoutDb([{ ...sources[0], url_or_query: 'https://example.org/atom' }, sources[1]]);
  const atom = `<feed><entry><title>Data inflasi</title><link rel="self" href="https://example.org/feed"/><link rel="alternate" href="https://example.org/article?id=7&amp;utm_source=x"/><published>bad</published><content>Data</content></entry><entry><title>Missing link</title></entry></feed>`;
  const { runScout } = await loadService('scout/scout.js', {
    client: db, fetchImpl: async (url) => new Response(url.includes('broken') ? '<html>maintenance</html>' : atom),
  });
  const result = await runScout({ force: true });
  assert.equal(result.totalNew, 1);
  assert.equal(result.sourceResults[0].invalid, 1);
  assert.equal(result.sourceResults[1].status, 'error');
  const raw = db.calls.find((call) => call.sql.includes('INSERT INTO raw_items'));
  assert.equal(raw.params[1], 'https://example.org/article?id=7');
  assert.equal(raw.params[5], null);
  assert.equal(db.calls[0].params[0], true);
});

test('Scout fetches source feeds concurrently with a bound and reports partial ingestion failures', async () => {
  const db = scoutDb(Array.from({ length: 7 }, (_, i) => ({ ...sources[0], id: i + 1 })));
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.includes('INSERT INTO raw_items') && params[0] === 2) throw new Error('test insert failed');
    return query(sql, params);
  };
  let active = 0;
  let peak = 0;
  const { runScout } = await loadService('scout/scout.js', {
    client: db, config: { scout: { max_items_per_source: 1 } },
    fetchImpl: async () => {
      peak = Math.max(peak, ++active);
      await new Promise(setImmediate);
      active--;
      return new Response(feed);
    },
  });
  const result = await runScout();
  assert.ok(peak > 1 && peak <= 4);
  assert.equal(result.totalNew, 6);
  assert.equal(result.sourceResults[1].status, 'error');
  assert.equal(result.sourceResults[6].inserted, 1);
});

test('X fallback ingestion uses the same limits, dedup threshold and safe dates as RSS', async () => {
  const db = scoutDb([{ id: 1, type: 'x_query', name: 'X IHSG', url_or_query: 'IHSG' }]);
  const { runScout } = await loadService('scout/scout.js', {
    client: db, config: { scout: { max_items_per_source: 1, dedup_similarity_threshold: 0.9 } },
    fetchImpl: async () => new Response(feed),
  });
  const result = await runScout();
  assert.equal(result.totalNew, 1);
  const topic = db.calls.find((call) => call.sql.includes('INSERT INTO topics'));
  assert.equal(topic.params[5], 'google_news_proxy');
  assert.equal(topic.params[4], 'Kontan');
  assert.equal(result.sourceResults[0].providers[0], 'google_news_proxy');
  assert.equal(db.calls.find((call) => call.sql.includes('INSERT INTO raw_items')).params[5], null);
});
