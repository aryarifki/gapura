import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pkg from 'pg';
import { persistTopicMaterial, loadLatestTopicMaterial } from '../../scout/material-store.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const migrationUrl = new URL('../../../database/migrations/20261117_article_materials.sql', import.meta.url);
const rootUrl = new URL('../../../', import.meta.url);
const headers = { 'Content-Type': 'application/json' };

// Deliberately independent of the packet builder and article reader under development.
function material(overrides = {}) {
  const article_url = 'https://publisher.example.org/news/material-fixture';
  const paragraphs = [
    { id: 'p1', text: 'Lembaga Uji mengumumkan kebijakan baru pada Senin untuk memperluas layanan kepada warga.', source_url: article_url, role: 'reporting' },
    { id: 'p2', text: 'Pelaksanaan tahap pertama mencakup tiga wilayah dan dimulai sesuai jadwal dalam dokumen.', source_url: article_url, role: 'document' },
    { id: 'p3', text: '"Layanan tetap dibuka," kata Kepala Lembaga Uji dalam keterangan tertulis yang diterbitkan.', source_url: article_url, role: 'official_statement' },
  ];
  return {
    version: 1, raw_title: '[X] Kebijakan untuk warga - Penerbit Uji', headline: 'Kebijakan untuk warga',
    provider: 'google_news_proxy', publisher: 'Penerbit Uji',
    discovery_url: 'https://news.google.com/rss/articles/material-fixture', article_url,
    published_at: '2026-11-15T07:00:00.000Z', updated_at: '2026-11-16T08:00:00.000Z', retrieved_at: '2026-11-17T09:00:00.000Z',
    body: paragraphs.map(({ text }) => text).join('\n\n').repeat(5), paragraphs, images: [],
    discovery_summary: 'Radar ringkasan tetap berdiri sendiri dari body artikel.',
    extraction: { kind: 'article_html', status: 'full', error_code: null }, ...overrides,
  };
}

test.before(() => {
  if (!enabled) return;
  assert.equal(process.env.NODE_ENV, 'test', 'only the isolated fixture server may run these tests');
  assert.equal(process.env.GAPURA_DISABLE_WORKERS, 'true', 'workers/timers must remain disabled');
  assert.match(process.env.HME_DB_NAME || '', /^gapura_test_[a-z0-9_]+$/);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.HME_DB_HOST));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
});
test.after(async () => { if (pool) await pool.end(); });

async function schemaFixture(t) {
  const client = await pool.connect();
  const schema = `material_fixture_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => {
    try {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally { client.release(); }
  });
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  await client.query(await readFile(new URL('database/schema.sql', rootUrl), 'utf8'));
  const files = (await readdir(new URL('database/migrations/', rootUrl)))
    .filter((file) => file.endsWith('.sql') && file !== '20261117_article_materials.sql').sort();
  for (const file of files) await client.query(await readFile(new URL(`database/migrations/${file}`, rootUrl), 'utf8'));
  return { client, schema, migration: await readFile(migrationUrl, 'utf8') };
}

async function seedTopic(t) {
  const { rows: [topic] } = await pool.query(
    `INSERT INTO topics(title,summary,url,primary_source,status)
     VALUES('Judul Radar lama','Ringkasan singkat Radar tetap terpisah.','https://news.google.com/rss/articles/material-fixture','Penerbit Uji','new') RETURNING *`,
  );
  t.after(() => pool.query('DELETE FROM topics WHERE id=$1', [topic.id]));
  return topic;
}

async function getMaterial(id) {
  const response = await fetch(`${base}/api/topics/${id}/material`, { headers });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('material migration: fresh schema plus every migration accepts idempotent material snapshots', { skip: !enabled }, async (t) => {
  const { client, schema, migration } = await schemaFixture(t);
  await client.query(migration);
  const { rows: columns } = await client.query(
    `SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
     WHERE table_schema=$1 AND ((table_name IN ('raw_items','trend_items') AND column_name='source_material')
       OR (table_name='topics' AND column_name IN ('raw_title','normalized_title','source_published_at','source_updated_at','material_status')))`, [schema],
  );
  assert.equal(columns.length, 7);
  for (const column of columns) {
    assert.equal(column.is_nullable, 'YES');
    assert.equal(column.column_default, null, `${column.table_name}.${column.column_name} must not fabricate old metadata`);
    assert.equal(column.data_type, column.column_name === 'source_material' ? 'jsonb'
      : column.column_name.endsWith('_at') ? 'timestamp with time zone' : 'text');
  }
  const { rows: [topic] } = await client.query("INSERT INTO topics(title) VALUES('Fresh fixture') RETURNING id");
  const input = material();
  const first = await persistTopicMaterial(client, topic.id, input);
  await client.query(migration);
  const duplicate = await persistTopicMaterial(client, topic.id, { ...input, retrieved_at: '2026-11-18T09:00:00.000Z' });
  assert.equal(first.is_existing, false);
  assert.deepEqual(duplicate, { ...first, is_existing: true });
  const loaded = await loadLatestTopicMaterial(client, topic.id);
  assert.deepEqual(loaded.material, input);
  assert.ok(loaded.created_at instanceof Date && loaded.last_seen_at instanceof Date);
  await client.query('DELETE FROM topics WHERE id=$1', [topic.id]);
  assert.equal(await loadLatestTopicMaterial(client, topic.id), null, 'topic deletion cascades only to its snapshots');
});

test('material migration: upgrade preserves every historical field and leaves new evidence metadata null', { skip: !enabled }, async (t) => {
  const { client, migration } = await schemaFixture(t);
  const { rows: [source] } = await client.query("INSERT INTO sources(name,type,url_or_query,category) VALUES('History fixture','rss','https://publisher.example.org/feed','news_pasar') RETURNING id");
  const { rows: [raw] } = await client.query(
    `INSERT INTO raw_items(source_id,title,content_raw,url,url_hash,published_at,fetched_at)
     VALUES($1,'Judul asli lama','Ringkasan lama','https://publisher.example.org/legacy',$2,'2020-01-02T00:00:00Z','2020-01-03T00:00:00Z') RETURNING id`, [source.id, 'a'.repeat(64)],
  );
  await client.query("INSERT INTO topics(raw_item_id,title,summary,url,created_at,updated_at) VALUES($1,'Judul topik lama','Ringkasan topik lama','https://publisher.example.org/legacy','2020-01-03T00:00:00Z','2020-01-04T00:00:00Z')", [raw.id]);
  await client.query("INSERT INTO trend_items(platform,provider,title,snippet,published_at) VALUES('news','legacy','Judul trend lama','Ringkasan trend lama',NULL)");
  const snapshot = async () => ({
    topics: (await client.query("SELECT to_jsonb(t)-ARRAY['raw_title','normalized_title','source_published_at','source_updated_at','material_status'] AS evidence FROM topics t ORDER BY id")).rows,
    raw: (await client.query("SELECT to_jsonb(r)-'source_material' AS evidence FROM raw_items r ORDER BY id")).rows,
    trends: (await client.query("SELECT to_jsonb(t)-'source_material' AS evidence FROM trend_items t ORDER BY id")).rows,
  });
  const before = await snapshot();
  await client.query(migration);
  await client.query(migration);
  assert.deepEqual(await snapshot(), before);
  const { rows: topics } = await client.query('SELECT raw_title,normalized_title,source_published_at,source_updated_at,material_status FROM topics');
  assert.deepEqual(topics, [{ raw_title: null, normalized_title: null, source_published_at: null, source_updated_at: null, material_status: null }]);
  assert.ok((await client.query('SELECT source_material FROM raw_items UNION ALL SELECT source_material FROM trend_items')).rows.every((row) => row.source_material === null));
  assert.equal((await client.query('SELECT count(*)::int AS count FROM topic_materials')).rows[0].count, 0);
});

test('material store database: repeated older content becomes latest without changing original evidence or Radar metadata', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  const input = material();
  const first = await persistTopicMaterial(pool, topic.id, input);
  const second = await persistTopicMaterial(pool, topic.id, material({ body: `${input.body}\nPerubahan sumber.`, extraction: { kind: 'article_html', status: 'partial', error_code: 'upstream_partial' } }));
  await pool.query("UPDATE topic_materials SET created_at='2001-01-01',last_seen_at='2001-01-01' WHERE id=$1", [first.id]);
  await pool.query("UPDATE topic_materials SET created_at='2002-01-01',last_seen_at='2002-01-01' WHERE id=$1", [second.id]);
  assert.equal((await loadLatestTopicMaterial(pool, topic.id)).id, second.id);
  const duplicate = await persistTopicMaterial(pool, topic.id, { ...input, retrieved_at: '2026-11-18T09:00:00.000Z' });
  assert.deepEqual(duplicate, { ...first, is_existing: true });
  const loaded = await loadLatestTopicMaterial(pool, topic.id);
  assert.equal(loaded.id, first.id);
  assert.deepEqual(loaded.material, input);
  assert.equal(loaded.created_at.toISOString(), '2001-01-01T00:00:00.000Z');
  assert.ok(loaded.last_seen_at > new Date('2002-01-01T00:00:00Z'));
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM topic_materials WHERE topic_id=$1', [topic.id])).rows[0].count, 2);
  assert.deepEqual((await pool.query('SELECT * FROM topics WHERE id=$1', [topic.id])).rows[0], topic);
});

test('material store database: concurrent duplicates share one snapshot and one insert result', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  const input = material();
  const results = await Promise.all(Array.from({ length: 6 }, () => persistTopicMaterial(pool, topic.id, input)));
  assert.equal(new Set(results.map((row) => row.id)).size, 1);
  assert.equal(results.filter((row) => !row.is_existing).length, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM topic_materials WHERE topic_id=$1', [topic.id])).rows[0].count, 1);
  assert.deepEqual((await loadLatestTopicMaterial(pool, topic.id)).material, input);
});

test('material API: body, canonical/discovery URLs, real dates and raw/clean headlines remain separate from Radar summary', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  const input = material();
  await persistTopicMaterial(pool, topic.id, input);
  const before = await loadLatestTopicMaterial(pool, topic.id);
  const packet = await getMaterial(topic.id);
  assert.equal(packet.topic.title, topic.title);
  assert.equal(packet.topic.summary, topic.summary);
  assert.deepEqual(packet.material, input);
  assert.ok(packet.material.body.length > 1000);
  assert.notEqual(packet.material.body, packet.topic.summary);
  assert.equal(packet.material.discovery_summary, input.discovery_summary);
  assert.notEqual(packet.material.article_url, packet.material.discovery_url);
  assert.ok(Array.isArray(packet.warnings));
  const warnings = JSON.stringify(packet.warnings);
  assert.match(warnings, /analis|analysis|score/i, 'missing analysis must be explicit');
  assert.match(warnings, /copywriter|draft|draf/i, 'missing writing stage must be explicit');
  assert.doesNotMatch(warnings, /verif/i, 'material retrieval does not introduce a new verifier dependency');
  await getMaterial(topic.id);
  assert.deepEqual(await loadLatestTopicMaterial(pool, topic.id), before, 'GET never modifies content or observation timestamps');
  assert.deepEqual((await pool.query('SELECT * FROM topics WHERE id=$1', [topic.id])).rows[0], topic);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM drafts WHERE topic_id=$1', [topic.id])).rows[0].count, 0);
});

test('material API: enrichment refreshes only material and never accepts a caller-supplied URL', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  const full = material();
  await persistTopicMaterial(pool, topic.id, full);
  const response = await fetch(`${base}/api/topics/${topic.id}/material/enrich`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual((await response.json()).material, full, 'existing full packet is reusable without a network call');
  for (const body of [{ url: 'https://localhost/private' }, { refresh: 'yes' }, { unknown: true }]) {
    const invalid = await fetch(`${base}/api/topics/${topic.id}/material/enrich`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(invalid.status, 400);
  }
  const rejected = await fetch(`${base}/api/topics/${topic.id}/material/enrich`, { method: 'POST', headers: { ...headers, Origin: 'https://other.example.org' }, body: '{}' });
  assert.equal(rejected.status, 403);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM drafts WHERE topic_id=$1', [topic.id])).rows[0].count, 0);
  assert.deepEqual((await pool.query('SELECT * FROM topics WHERE id=$1', [topic.id])).rows[0], topic);
});

test('material API: invalid legacy source URL is rejected without outbound requests', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  await pool.query("UPDATE topics SET url='https://127.0.0.1/private' WHERE id=$1", [topic.id]);
  const response = await fetch(`${base}/api/topics/${topic.id}/material/enrich`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 409, await response.clone().text());
  assert.equal(await loadLatestTopicMaterial(pool, topic.id), null);
});

test('material API: historical topics without a snapshot report missing material and missing stages honestly', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  const packet = await getMaterial(topic.id);
  assert.equal(packet.material, null);
  assert.equal(packet.topic.summary, topic.summary);
  assert.equal(packet.topic.raw_title, null);
  assert.equal(packet.topic.source_published_at, null);
  assert.equal(packet.topic.source_updated_at, null);
  assert.equal(packet.topic.material_status, null);
  assert.ok(Array.isArray(packet.warnings) && packet.warnings.length > 0);
  assert.match(JSON.stringify(packet.warnings), /material|materi/i);
  assert.equal(await loadLatestTopicMaterial(pool, topic.id), null);
});

test('material API: partial and inaccessible source statuses survive without fabricated body or dates', { skip: !enabled }, async (t) => {
  for (const status of ['partial', 'summary_only', 'paywall', 'access_denied', 'robots_disallowed', 'rate_limited', 'parse_failed', 'unavailable']) {
    const topic = await seedTopic(t);
    const input = material({ body: '', paragraphs: [], article_url: null, published_at: null, updated_at: null,
      extraction: { kind: ['partial', 'summary_only'].includes(status) ? 'feed_summary' : null, status, error_code: 'fixture_unavailable' } });
    await persistTopicMaterial(pool, topic.id, input);
    const packet = await getMaterial(topic.id);
    assert.deepEqual(packet.material, input);
    assert.equal(packet.topic.summary, topic.summary);
  }
});

test('material API: observed-again snapshots are latest and missing/invalid topic IDs return clear errors', { skip: !enabled }, async (t) => {
  const topic = await seedTopic(t);
  const input = material();
  const first = await persistTopicMaterial(pool, topic.id, input);
  const second = await persistTopicMaterial(pool, topic.id, material({ body: 'Isi revisi baru.', paragraphs: [], extraction: { kind: 'article_html', status: 'partial', error_code: null } }));
  await pool.query("UPDATE topic_materials SET last_seen_at='2001-01-01' WHERE id=$1", [first.id]);
  await pool.query("UPDATE topic_materials SET last_seen_at='2002-01-01' WHERE id=$1", [second.id]);
  assert.equal((await getMaterial(topic.id)).material.body, 'Isi revisi baru.');
  await persistTopicMaterial(pool, topic.id, { ...input, retrieved_at: '2026-11-18T09:00:00.000Z' });
  assert.deepEqual((await getMaterial(topic.id)).material, input);
  assert.equal((await fetch(`${base}/api/topics/9007199254740991/material`, { headers })).status, 404);
  for (const id of ['0', '-1', 'not-an-id', '1.5']) assert.equal((await fetch(`${base}/api/topics/${id}/material`, { headers })).status, 400);
});

test('material API: enrichment budgets are separated by trusted loopback client headers', { skip: !enabled }, async () => {
  for (const address of ['198.51.100.10', '198.51.100.20']) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetch(`${base}/api/topics/9007199254740991/material/enrich`, { method: 'POST', headers: { ...headers, 'CF-Connecting-IP': address }, body: '{}' });
      assert.equal(response.status, 404, address);
    }
    const limited = await fetch(`${base}/api/topics/9007199254740991/material/enrich`, { method: 'POST', headers: { ...headers, 'CF-Connecting-IP': address }, body: '{}' });
    assert.equal(limited.status, 429, address);
  }
});

test('Firecrawl credentials cannot be written through the unauthenticated dashboard API', { skip: !enabled }, async () => {
  const response = await fetch(`${base}/api/seo/search-key`, {
    method: 'POST', headers, body: JSON.stringify({ api_key: `fc-${'a'.repeat(32)}` }),
  });
  assert.equal(response.status, 404);
  const provider = await fetch(`${base}/api/providers/firecrawl_test`, {
    method: 'POST', headers, body: JSON.stringify({ label: 'Firecrawl Search', kind: 'openai', base_url: 'https://api.firecrawl.dev', api_key_env: 'FIRECRAWL_API_KEY', enabled: false }),
  });
  assert.equal(provider.status, 403);
  const configPath = process.env.PROVIDERS_CONFIG_PATH;
  const original = await readFile(configPath);
  const config = JSON.parse(original);
  config.providers.firecrawl_test = { label: 'Firecrawl Search', kind: 'openai', base_url: 'https://api.firecrawl.dev', api_key_env: 'FIRECRAWL_API_KEY', enabled: false };
  await writeFile(configPath, JSON.stringify(config));
  try {
    const providerKey = await fetch(`${base}/api/providers/firecrawl_test/key`, {
      method: 'POST', headers, body: JSON.stringify({ api_key: `fc-${'b'.repeat(32)}` }),
    });
    assert.equal(providerKey.status, 403);
  } finally { await writeFile(configPath, original); }
});
