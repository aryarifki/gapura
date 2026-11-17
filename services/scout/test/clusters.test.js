import test from 'node:test';
import assert from 'node:assert/strict';
import { assignTopicCluster, loadTopicCluster, titleSimilarity, titleTokens } from '../clusters.js';

function clusterDb(rows = []) {
  const topics = rows.map((row) => ({ ...row }));
  const clusters = [];
  let nextClusterId = 1;
  const calls = [];
  return {
    calls,
    topics,
    clusters,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('SELECT id, title, cluster_id FROM topics')) {
        const [topicId, desk, windowHours] = params;
        const cutoff = Date.now() - windowHours * 3600 * 1000;
        return {
          rows: topics.filter((topic) => String(topic.id) !== String(topicId) && topic.desk === desk
            && (!topic.created_at || Date.parse(topic.created_at) >= cutoff))
            .sort((a, b) => b.id - a.id),
        };
      }
      if (sql.includes('INSERT INTO topic_clusters')) {
        const cluster = { id: nextClusterId++, desk: params[0], representative_topic_id: params[1], title_key: params[2] };
        clusters.push(cluster);
        return { rows: [{ id: cluster.id }] };
      }
      if (sql.includes('UPDATE topics SET cluster_id')) {
        const topic = topics.find((row) => String(row.id) === String(params[1]));
        if (topic) topic.cluster_id = params[0];
        return { rows: [] };
      }
      if (sql.includes('SELECT * FROM topics WHERE id')) {
        const topic = topics.find((row) => String(row.id) === String(params[0]));
        return { rows: topic ? [topic] : [] };
      }
      if (sql.includes('SELECT * FROM topic_clusters WHERE id')) {
        const cluster = clusters.find((row) => String(row.id) === String(params[0]));
        return { rows: cluster ? [cluster] : [] };
      }
      if (sql.includes('SELECT * FROM topics WHERE cluster_id')) {
        return { rows: topics.filter((topic) => String(topic.cluster_id) === String(params[0])).sort((a, b) => a.id - b.id) };
      }
      return { rows: [] };
    },
  };
}

const time = (hoursAgo) => new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();

test('title tokens ignore stopwords and similarity detects the same event across publishers', () => {
  assert.deepEqual(titleTokens('IHSG Ditutup Melemah dan Saham Bank Memimpin'), ['ihsg', 'ditutup', 'melemah', 'saham', 'bank', 'memimpin']);
  assert.ok(titleSimilarity('IHSG ditutup melemah, saham bank memimpin', 'Saham bank memimpin, IHSG ditutup melemah') > 0.9);
  assert.ok(titleSimilarity('IHSG ditutup melemah', 'Kebijakan pendidikan diperluas') < 0.1);
});

test('near-duplicate reports across different URLs join one cluster while distinct issues stay separate', async () => {
  const db = clusterDb([
    { id: 1, title: 'IHSG ditutup melemah, saham bank memimpin', desk: 'bursa', cluster_id: null, created_at: time(2), url: 'https://a.example/1' },
    { id: 2, title: 'Saham bank memimpin pelemahan IHSG', desk: 'bursa', cluster_id: null, created_at: time(3), url: 'https://b.example/2' },
    { id: 3, title: 'Kebijakan pendidikan diperluas', desk: 'sosial', cluster_id: null, created_at: time(4), url: 'https://c.example/3' },
  ]);
  const first = await assignTopicCluster(db, { id: 1, title: 'IHSG ditutup melemah, saham bank memimpin', desk: 'bursa' });
  const second = await assignTopicCluster(db, { id: 2, title: 'Saham bank memimpin pelemahan IHSG', desk: 'bursa' });
  const third = await assignTopicCluster(db, { id: 3, title: 'Kebijakan pendidikan diperluas', desk: 'sosial' });
  assert.ok(first);
  assert.equal(second, first);
  assert.ok(third);
  assert.notEqual(third, first);
  assert.equal(db.topics.find((topic) => topic.id === 1).cluster_id, first);
  assert.equal(db.topics.find((topic) => topic.id === 2).cluster_id, first);
  assert.equal(db.topics.filter((topic) => topic.cluster_id === first).length, 2);
});

test('a topic without a desk is not clustered and old reports outside the window are ignored', async () => {
  const db = clusterDb([
    { id: 1, title: 'IHSG ditutup melemah', desk: 'bursa', cluster_id: null, created_at: time(24 * 10) },
    { id: 2, title: 'IHSG ditutup melemah', desk: 'bursa', cluster_id: null, created_at: time(1) },
  ]);
  assert.equal(await assignTopicCluster(db, { id: 2, title: 'IHSG ditutup melemah', desk: null }), null);
  assert.equal(db.clusters.length, 0);
  const cluster = await assignTopicCluster(db, { id: 2, title: 'IHSG ditutup melemah', desk: 'bursa' }, { windowHours: 72 });
  assert.ok(cluster);
  assert.equal(db.topics.find((topic) => topic.id === 2).cluster_id, cluster);
  assert.equal(db.topics.find((topic) => topic.id === 1).cluster_id, null, 'an old report outside the window is not attached');
});

test('cluster reads expose projected members and a missing topic returns null', async () => {
  const db = clusterDb([
    { id: 1, title: 'IHSG ditutup melemah', raw_title: 'IHSG ditutup melemah - Kontan', normalized_title: 'IHSG ditutup melemah', url: 'https://a.example/1', primary_source: 'Kontan', source_id: 2, desk: 'bursa', cluster_id: 9, created_at: time(2), summary: 'SECRET' },
    { id: 2, title: 'Saham bank memimpin pelemahan IHSG', raw_title: 'Saham bank memimpin pelemahan IHSG', normalized_title: 'Saham bank memimpin pelemahan IHSG', url: 'https://b.example/2', primary_source: 'Bisnis', source_id: 3, desk: 'bursa', cluster_id: 9, created_at: time(3), summary: 'SECRET' },
  ]);
  db.clusters.push({ id: 9, desk: 'bursa', representative_topic_id: 1, title_key: 'ihsg ditutup melemah' });
  const result = await loadTopicCluster(db, 1);
  assert.equal(result.cluster.id, 9);
  assert.equal(result.members.length, 2);
  assert.ok(result.members.every((member) => !JSON.stringify(member).includes('SECRET')));
  assert.deepEqual(Object.keys(result.members[0]).sort(), ['desk', 'discovered_at', 'normalized_title', 'published_at', 'raw_title', 'source_id', 'source_name', 'source_url', 'topic_keywords'].sort());
  assert.equal(await loadTopicCluster(db, 999), null);
});
