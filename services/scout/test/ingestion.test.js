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
    if (sql.includes('INSERT INTO topics')) return { rows: [{ id }] };
    if (sql.includes('INSERT INTO topic_materials')) return { rows: [{ id, content_hash: 'a'.repeat(64), inserted: true }] };
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

test('Scout saves full permitted feed material and source timestamps separately from its short summary', async () => {
  const db = scoutDb([{ id: 1, name: 'Media Uji', type: 'rss', category: 'politik', url_or_query: 'https://publisher.example.org/rss' }]);
  const paragraphs = Array.from({ length: 12 }, (_, i) => `<p>Paragraf ${i + 1} menjelaskan kebijakan layanan publik beserta latar, pelaksanaan, dan jadwal yang tersedia dalam sumber resmi.</p>`).join('');
  const xml = `<rss><channel><item><title>Kebijakan baru - Media Uji</title><link>https://publisher.example.org/news/one</link><source>Media Uji</source><description>Ringkasan pendek.</description><content:encoded><![CDATA[${paragraphs}]]></content:encoded><pubDate>2026-11-16T08:00:00Z</pubDate><updated>2026-11-16T10:00:00Z</updated></item></channel></rss>`;
  const { runScout } = await loadService('scout/scout.js', { client: db, fetchImpl: async () => new Response(xml) });
  const result = await runScout();
  assert.equal(result.totalNew, 1);
  const raw = db.calls.find((call) => call.sql.includes('INSERT INTO raw_items'));
  assert.ok(raw.params[4].length > 1000, 'raw source body is not clipped to Radar summary size');
  const rawMaterial = raw.params.find((value) => typeof value === 'string' && value.includes('"paragraphs"'));
  assert.ok(rawMaterial);
  const material = JSON.parse(rawMaterial);
  assert.equal(material.body.length, raw.params[4].length);
  assert.equal(material.paragraphs.length, 12);
  assert.equal(material.extraction.status, 'full');
  assert.equal(material.published_at, '2026-11-16T08:00:00.000Z');
  assert.equal(material.updated_at, '2026-11-16T10:00:00.000Z');
  const topic = db.calls.find((call) => call.sql.includes('INSERT INTO topics'));
  assert.equal(topic.params[1], 'Kebijakan baru');
  assert.ok(topic.params[2].length <= 1000);
  assert.ok(db.calls.some((call) => call.sql.includes('INSERT INTO topic_materials')));
  assert.ok(!db.calls.some((call) => call.sql.includes('INSERT INTO drafts')));
});

test('Scout preserves mixed Atom XHTML source order in raw body and persisted material paragraphs', async () => {
  const db = scoutDb([sources[0]]);
  const xml = `<feed><entry><title>  Kebijakan &amp; rincian - Media Uji  </title>
    <link rel="self" href="https://publisher.example.org/feed/1"/>
    <link rel="alternate" href="https://publisher.example.org/news/1?utm_source=atom"/>
    <source><title>Media Uji</title><link href="https://publisher.example.org"/></source>
    <summary type="html">&lt;p&gt;Ringkasan &amp;amp; rincian.&lt;/p&gt;&lt;img src="https://pbs.twimg.com/media/summary.jpg"&gt;</summary>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>First</p><h2>Middle</h2><p>Last</p><img src="https://cdn.example.org/body.jpg"/></div></content>
    <media:thumbnail url="https://img.antaranews.com/cover.jpg"/>
    <published>2026-11-16T08:00:00Z</published><updated>2026-11-16T10:00:00Z</updated>
  </entry></feed>`;
  const { runScout } = await loadService('scout/scout.js', { client: db, fetchImpl: async () => new Response(xml) });
  const result = await runScout();
  assert.equal(result.totalNew, 1);
  const raw = db.calls.find((call) => call.sql.includes('INSERT INTO raw_items'));
  assert.equal(raw.params[4], 'First\n\nMiddle\n\nLast');
  assert.equal(raw.params[3], 'Kebijakan &amp; rincian - Media Uji');
  const material = JSON.parse(db.calls.find((call) => call.sql.includes('INSERT INTO topic_materials')).params[2]);
  assert.equal(material.body, 'First\n\nMiddle\n\nLast');
  assert.deepEqual(material.paragraphs.map((paragraph) => paragraph.text), ['First', 'Middle', 'Last']);
  assert.deepEqual(material.paragraphs.map((paragraph) => paragraph.id), ['p1', 'p2', 'p3']);
  assert.equal(material.headline, 'Kebijakan & rincian');
  assert.equal(material.publisher, 'Media Uji');
  assert.equal(material.published_at, '2026-11-16T08:00:00.000Z');
  assert.equal(material.updated_at, '2026-11-16T10:00:00.000Z');
  assert.deepEqual(material.images.map((image) => image.url).sort(), [
    'https://cdn.example.org/body.jpg', 'https://img.antaranews.com/cover.jpg', 'https://pbs.twimg.com/media/summary.jpg',
  ]);
  const topic = db.calls.find((call) => call.sql.includes('INSERT INTO topics'));
  assert.equal(topic.params[2], 'Ringkasan & rincian.');
  assert.equal(topic.params[7], 'https://publisher.example.org/');
});

test('Scout preserves feed styles until material extraction removes hidden body evidence', async () => {
  const db = scoutDb([sources[0]]);
  const html = '<style>.hidden { display: none; }</style><p>First</p><p class="hidden">Stylesheet hidden</p><p style="display:none">Inline hidden</p><p hidden="hidden">Attribute hidden</p><h2>Middle</h2><p>Last</p><script>ignore()</script>';
  const xml = `<rss><channel><item><title>Visible source report</title><link>https://publisher.example.org/visible</link><description>Source summary.</description><content:encoded><![CDATA[${html}]]></content:encoded></item></channel></rss>`;
  const { runScout } = await loadService('scout/scout.js', { client: db, fetchImpl: async () => new Response(xml) });
  const result = await runScout();
  assert.equal(result.totalNew, 1);
  const raw = db.calls.find((call) => call.sql.includes('INSERT INTO raw_items'));
  assert.equal(raw.params[4], 'First\n\nMiddle\n\nLast');
  const material = JSON.parse(db.calls.find((call) => call.sql.includes('INSERT INTO topic_materials')).params[2]);
  assert.deepEqual(material.paragraphs.map((paragraph) => paragraph.text), ['First', 'Middle', 'Last']);
  assert.doesNotMatch(material.body, /hidden|ignore\(\)|display/);
});

for (const type of ['rss', 'x_query', 'x_account']) {
  for (const [label, firstItem, errorPattern] of [
    ['HTTP', '<item><title>HTTP item</title><link>http://publisher.example.org/insecure</link><description>Unusable material.</description></item>', /invalid|valid|HTTPS/i],
    ['oversized', `<item><title>Oversized item</title><link>https://publisher.example.org/large</link><content:encoded><![CDATA[${'a'.repeat(100_001)}]]></content:encoded></item>`, /100000/],
  ]) {
    test(`Scout ${type} counts an ${label} item once and ingests the following valid item with partial diagnostics`, async () => {
      const db = scoutDb([{ ...sources[0], type, ...(type !== 'rss' ? { url_or_query: type === 'x_query' ? 'IHSG' : '@media' } : {}) }]);
      const xml = `<rss><channel>${firstItem}<item><title>Valid next item</title><link>https://publisher.example.org/valid</link><description>Valid source evidence.</description></item></channel></rss>`;
      const { runScout } = await loadService('scout/scout.js', { client: db, fetchImpl: async () => new Response(xml) });
      const result = await runScout();
      assert.equal(result.totalNew, 1);
      assert.equal(result.totalFetched, 2);
      const diagnostic = result.sourceResults[0];
      assert.equal(diagnostic.seen, 2);
      assert.equal(diagnostic.invalid, 1);
      assert.equal(diagnostic.errors, 0);
      assert.equal(diagnostic.inserted, 1);
      assert.equal(diagnostic.status, 'partial');
      assert.match(diagnostic.error, errorPattern);
      const saved = db.calls.filter((call) => call.sql.includes('INSERT INTO raw_items'));
      assert.equal(saved.length, 1);
      assert.equal(saved[0].params[1], 'https://publisher.example.org/valid');
      const update = db.calls.find((call) => call.sql.includes('UPDATE sources'));
      assert.equal(JSON.parse(update.params[2]).status, 'partial');
      assert.equal(update.params[1], diagnostic.error);
      assert.equal(db.calls.find((call) => call.sql.includes('INSERT INTO agent_runs')).params[0], 'error');
    });
  }
}

test('invalid feed entries still consume the configured per-source item limit', async () => {
  const db = scoutDb([sources[0]]);
  const xml = '<rss><channel><item><link>https://publisher.example.org/no-title</link></item><item><title>Outside limit</title><link>https://publisher.example.org/valid</link></item></channel></rss>';
  const { runScout } = await loadService('scout/scout.js', {
    client: db, config: { scout: { max_items_per_source: 1 } }, fetchImpl: async () => new Response(xml),
  });
  const result = await runScout();
  assert.equal(result.totalNew, 0);
  assert.equal(result.totalFetched, 1);
  assert.equal(result.sourceResults[0].seen, 1);
  assert.equal(result.sourceResults[0].invalid, 1);
  assert.equal(result.sourceResults[0].status, 'error');
  assert.equal(db.calls.some((call) => call.sql.includes('INSERT INTO raw_items')), false);
});

for (const failingSql of ['SELECT id FROM raw_items', 'INSERT INTO raw_items', 'INSERT INTO topics', 'INSERT INTO topic_materials', 'COMMIT']) {
  test(`Scout isolates an item failure at ${failingSql} and continues its source and subsequent sources`, async () => {
    const db = scoutDb(sources);
    const query = db.query.bind(db);
    let failed = false;
    db.query = async (sql, params) => {
      if (!failed && sql.includes(failingSql)) {
        failed = true;
        db.calls.push({ sql, params });
        throw new Error('fixture item processing failed');
      }
      return query(sql, params);
    };
    const { runScout } = await loadService('scout/scout.js', {
      client: db, config: { scout: { max_items_per_source: 2 } }, fetchImpl: async () => new Response(feed),
    });
    const result = await runScout();
    assert.equal(result.totalFetched, 4);
    assert.equal(result.totalNew, 3);
    assert.equal(result.sourceResults[0].seen, 2);
    assert.equal(result.sourceResults[0].invalid, 0);
    assert.equal(result.sourceResults[0].errors, 1);
    assert.equal(result.sourceResults[0].inserted, 1);
    assert.equal(result.sourceResults[0].status, 'partial');
    assert.match(result.sourceResults[0].error, /fixture item processing failed/);
    assert.equal(result.sourceResults[1].status, 'success');
    assert.equal(result.sourceResults[1].inserted, 2);
    const rollbackIndex = db.calls.findIndex((call) => call.sql === 'ROLLBACK');
    if (failingSql.startsWith('SELECT')) {
      assert.equal(rollbackIndex, -1);
    } else {
      assert.ok(rollbackIndex > 0);
      assert.ok(db.calls.slice(rollbackIndex + 1).some((call) => call.sql === 'BEGIN'));
      assert.equal(db.calls.filter((call) => call.sql === 'ROLLBACK').length, 1);
    }
    assert.equal(db.calls.find((call) => call.sql.includes('INSERT INTO agent_runs')).params[0], 'error');
  });
}

test('a failed source diagnostic write does not stop later sources', async () => {
  const db = scoutDb(sources);
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (sql.includes('UPDATE sources') && params[0] === 1) throw new Error('fixture source diagnostic write failed');
    return query(sql, params);
  };
  const { runScout } = await loadService('scout/scout.js', {
    client: db, config: { scout: { max_items_per_source: 1 } }, fetchImpl: async () => new Response(feed),
  });
  const result = await runScout();
  assert.equal(result.totalNew, 2);
  assert.equal(result.sourceResults[0].status, 'partial');
  assert.equal(result.sourceResults[0].errors, 1);
  assert.match(result.sourceResults[0].error, /fixture source diagnostic write failed/);
  assert.equal(result.sourceResults[1].status, 'success');
  assert.equal(db.calls.find((call) => call.sql.includes('INSERT INTO agent_runs')).params[0], 'error');
});

test('malformed XML and nested feed roots fail the whole source while later feeds still ingest', async () => {
  for (const invalidXml of [
    '<rss><channel><item><title>Broken XML</title></channel></rss>',
    `<html>${feed}</html>`,
  ]) {
    const db = scoutDb(sources);
    const { runScout } = await loadService('scout/scout.js', {
      client: db, config: { scout: { max_items_per_source: 1 } },
      fetchImpl: async (url) => new Response(url.includes('broken') ? feed : invalidXml),
    });
    const result = await runScout();
    assert.equal(result.totalFetched, 1);
    assert.equal(result.totalNew, 1);
    assert.equal(result.sourceResults[0].status, 'error');
    assert.equal(result.sourceResults[0].seen, 0);
    assert.match(result.sourceResults[0].error, /XML|RSS\/Atom/);
    assert.equal(result.sourceResults[1].status, 'success');
  }
});
