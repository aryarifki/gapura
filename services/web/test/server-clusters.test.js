import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pkg from 'pg';
import { assignTopicCluster, loadTopicCluster } from '../../scout/clusters.js';
import { inferDesk } from '../../common/discovery.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const pool = enabled ? new pkg.Pool({
  host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT,
  user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME,
}) : null;
const headers = { 'Content-Type': 'application/json' };
const migrationUrl = new URL('../../../database/migrations/20261117_topic_desks_clusters.sql', import.meta.url);

async function applyMigration() {
  const sql = await readFile(migrationUrl, 'utf8');
  await pool.query(sql);
}

test('R4 migration is idempotent and adds desk, discovery metadata and cluster tables', { skip: !enabled }, async () => {
  await applyMigration();
  await applyMigration();
  const { rows: columns } = await pool.query(
    "SELECT table_name, column_name FROM information_schema.columns WHERE (table_name, column_name) IN (('sources','desk'),('topics','source_id'),('topics','desk'),('topics','topic_keywords'),('topics','cluster_id'))"
  );
  assert.equal(columns.length, 5);
  const { rows: tables } = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name = 'topic_clusters'");
  assert.equal(tables.length, 1);
  const { rows: constraints } = await pool.query(
    "SELECT conname FROM pg_constraint WHERE conname IN ('sources_desk_check','topics_desk_check','topic_clusters_desk_check')"
  );
  assert.equal(constraints.length, 3);
  await assert.rejects(() => pool.query("INSERT INTO sources(name,type,url_or_query,category,desk) VALUES('Bad desk','rss','https://example.org/feed','umum','hiburan')"), /check constraint/i);
});

test('source API persists desk, preserves it on partial updates and rejects an invalid desk', { skip: !enabled }, async () => {
  const created = await fetch(`${base}/api/sources`, {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'R4 Politik Feed', type: 'rss', url_or_query: 'https://example.org/r4-politik.xml', category: 'umum', desk: 'politik' }),
  });
  assert.equal(created.status, 200);
  const source = (await created.json()).source;
  assert.equal(source.desk, 'politik');

  const partial = await fetch(`${base}/api/sources/${source.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: source.name, type: source.type, url_or_query: source.url_or_query, category: source.category, poll_interval_mins: 45, is_active: true }),
  });
  assert.equal(partial.status, 200);
  assert.equal((await partial.json()).source.desk, 'politik', 'field desk yang tidak dikirim harus dipertahankan');

  const changed = await fetch(`${base}/api/sources/${source.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: source.name, type: source.type, url_or_query: source.url_or_query, category: source.category, desk: 'lingkungan', is_active: true }),
  });
  assert.equal(changed.status, 200);
  assert.equal((await changed.json()).source.desk, 'lingkungan');

  const invalid = await fetch(`${base}/api/sources/${source.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: source.name, type: source.type, url_or_query: source.url_or_query, category: source.category, desk: 'hiburan' }),
  });
  assert.equal(invalid.status, 400);
  await pool.query('DELETE FROM sources WHERE id = $1', [source.id]);
});

test('source API defaults new discovery to general issues and preserves a category omitted on edit', { skip: !enabled }, async () => {
  const response = await fetch(`${base}/api/sources`, {
    method: 'POST', headers,
    body: JSON.stringify({ name: 'National discovery default', url_or_query: 'https://example.org/national-default.xml' }),
  });
  assert.equal(response.status, 200);
  const source = (await response.json()).source;
  assert.equal(source.category, 'umum');
  assert.equal(source.desk, null);
  assert.equal(inferDesk({ category: source.category, title: 'DPR membahas perubahan kebijakan pemilu' }), 'politik');
  await pool.query("UPDATE sources SET category='jdih_hukum' WHERE id=$1", [source.id]);
  const updated = await fetch(`${base}/api/sources/${source.id}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ name: source.name, type: source.type, url_or_query: source.url_or_query, is_active: false }),
  });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).source.category, 'jdih_hukum');
  await pool.query('DELETE FROM sources WHERE id=$1', [source.id]);
});

test('national Trending seed covers all six desks, is idempotent and preserves existing settings', { skip: !enabled }, async () => {
  const { rows: before } = await pool.query('SELECT * FROM trend_sources ORDER BY id');
  const sql = await readFile(new URL('../../../database/migrations/20261117_trending_national_desks.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  await pool.query(sql);
  const { rows } = await pool.query('SELECT * FROM trend_sources ORDER BY id');
  for (const old of before) assert.deepEqual(rows.find((row) => row.id === old.id), old);
  for (const category of ['politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa']) {
    const candidates = rows.filter((row) => row.category === category && row.label.startsWith('Desk Gapura:'));
    assert.equal(candidates.length, 1, category);
    assert.equal(candidates[0].kind, 'news_query');
    assert.equal(candidates[0].is_active, true);
    assert.match(candidates[0].value, /Indonesia/);
  }
});

test('topics filter by desk and expose cross-URL clusters without publisher body', { skip: !enabled }, async () => {
  const { rows: [source] } = await pool.query(
    "INSERT INTO sources(name,type,url_or_query,category,desk) VALUES('Cluster fixture','rss','https://example.org/cluster.xml','umum','bursa') RETURNING id"
  );
  const insert = async (title, url, desk = 'bursa') => {
    const { rows: [topic] } = await pool.query(
      `INSERT INTO topics(title,summary,url,primary_source,status,source_kind,source_id,desk,topic_keywords)
       VALUES($1,'SECRET PUBLISHER BODY',$2,'Fixture Media','new','rss',$3,$4,$5) RETURNING id`,
      [title, url, source.id, desk, ['fixture', 'cluster']]
    );
    return topic.id;
  };
  const first = await insert('IHSG ditutup melemah, saham bank memimpin', 'https://example.org/cluster/1');
  const second = await insert('Saham bank memimpin pelemahan IHSG', 'https://example.org/cluster/2');

  const clusterId = await assignTopicCluster(pool, { id: first, title: 'IHSG ditutup melemah, saham bank memimpin', desk: 'bursa' });
  assert.ok(clusterId);
  assert.equal(await assignTopicCluster(pool, { id: second, title: 'Saham bank memimpin pelemahan IHSG', desk: 'bursa' }), clusterId);

  const filtered = await fetch(`${base}/api/topics?desk=bursa&q=IHSG`);
  assert.equal(filtered.status, 200);
  assert.ok((await filtered.json()).some((topic) => topic.id === first));
  const wrongDesk = await fetch(`${base}/api/topics?desk=hiburan`);
  assert.equal(wrongDesk.status, 400);

  const response = await fetch(`${base}/api/topics/${first}/cluster`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.cluster.id, clusterId);
  assert.deepEqual(data.members.map((member) => member.source_url).sort(), ['https://example.org/cluster/1', 'https://example.org/cluster/2']);
  assert.ok(data.members.every((member) => member.desk === 'bursa'));
  assert.ok(!JSON.stringify(data).includes('SECRET PUBLISHER BODY'));
  assert.ok(!JSON.stringify(data).includes('"summary"'));

  const loaded = await loadTopicCluster(pool, first);
  assert.equal(loaded.members.length, 2);
  assert.equal((await fetch(`${base}/api/topics/999999/cluster`)).status, 404);
  assert.equal((await fetch(`${base}/api/topics/not-a-number/cluster`)).status, 400);

  await pool.query('DELETE FROM topics WHERE id IN ($1, $2)', [first, second]);
  await pool.query('DELETE FROM topic_clusters WHERE id = $1', [clusterId]);
  await pool.query('DELETE FROM sources WHERE id = $1', [source.id]);
});
