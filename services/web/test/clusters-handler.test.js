import test from 'node:test';
import assert from 'node:assert/strict';
import { createTopicClusterHandler } from '../clusters.js';

function response() {
  const result = { statusCode: 200, body: null };
  result.status = (code) => { result.statusCode = code; return result; };
  result.json = (body) => { result.body = body; return result; };
  return result;
}

const topic = {
  id: 1, title: 'IHSG ditutup melemah', raw_title: 'IHSG ditutup melemah - Kontan', normalized_title: 'IHSG ditutup melemah',
  url: 'https://a.example/1', primary_source: 'Kontan', source_id: 2, desk: 'bursa', cluster_id: 9,
  created_at: '2026-11-17T02:00:00.000Z', summar: 'SECRET', summary: 'SECRET',
};
const member = { ...topic, id: 2, title: 'Saham bank memimpin pelemahan IHSG', url: 'https://b.example/2' };

function pool(handler) {
  return { query: async (sql, params) => handler(sql, params) };
}

test('cluster endpoint returns the cluster and allowlisted members', async () => {
  const db = pool((sql) => {
    if (sql.includes('SELECT * FROM topics WHERE id')) return { rows: [topic] };
    if (sql.includes('SELECT * FROM topic_clusters WHERE id')) return { rows: [{ id: 9, desk: 'bursa', representative_topic_id: 1 }] };
    if (sql.includes('SELECT * FROM topics WHERE cluster_id')) return { rows: [topic, member] };
    return { rows: [] };
  });
  const res = response();
  await createTopicClusterHandler({ pool: db })({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cluster.id, 9);
  assert.equal(res.body.members.length, 2);
  assert.ok(!JSON.stringify(res.body).includes('SECRET'));
});

test('cluster endpoint reports an unknown topic as 404 and rejects an invalid id', async () => {
  const missing = response();
  await createTopicClusterHandler({ pool: pool(() => ({ rows: [] })) })({ params: { id: '404' } }, missing);
  assert.equal(missing.statusCode, 404);
  const invalid = response();
  await createTopicClusterHandler({ pool: pool(() => ({ rows: [] })) })({ params: { id: 'abc' } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('cluster endpoint fails closed with a generic 503 when the database is unavailable', async () => {
  const res = response();
  const handler = createTopicClusterHandler({ pool: pool(() => { throw new Error('connection refused to 127.0.0.1'); }) });
  await handler({ params: { id: '1' } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'Cluster topik tidak dapat dibaca.' });
});
