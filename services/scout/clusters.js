import { normalizeDesk, projectDiscoveryTopic, titleTokens } from '../common/discovery.js';

export { titleTokens };

const DEFAULT_WINDOW_HOURS = 72;
const DEFAULT_THRESHOLD = 0.62;

export function titleSimilarity(left, right) {
  const first = new Set(titleTokens(left));
  const second = new Set(titleTokens(right));
  if (!first.size || !second.size) return 0;
  let shared = 0;
  for (const token of first) if (second.has(token)) shared++;
  return (2 * shared) / (first.size + second.size);
}

function titleKey(value) {
  return titleTokens(value).sort().join(' ');
}

async function createCluster(db, { desk, representativeId, title }) {
  const { rows } = await db.query(
    'INSERT INTO topic_clusters (desk, representative_topic_id, title_key) VALUES ($1, $2, $3) RETURNING id',
    [desk, representativeId, titleKey(title).slice(0, 500)]
  );
  return rows[0]?.id ?? null;
}

export async function assignTopicCluster(db, topic, { windowHours = DEFAULT_WINDOW_HOURS, threshold = DEFAULT_THRESHOLD } = {}) {
  const id = topic?.id;
  const desk = normalizeDesk(topic?.desk);
  const title = String(topic?.title || '').trim();
  if (!id || !desk || !title) return null;
  const { rows: candidates } = await db.query(
    `SELECT id, title, cluster_id FROM topics
     WHERE id <> $1 AND desk = $2 AND created_at >= NOW() - make_interval(hours => $3)
     ORDER BY created_at DESC, id DESC LIMIT 200`,
    [id, desk, windowHours]
  );
  let best = null;
  let bestScore = threshold;
  for (const candidate of candidates) {
    const score = titleSimilarity(title, candidate.title);
    if (score > bestScore) { best = candidate; bestScore = score; }
  }
  if (!best) {
    const clusterId = await createCluster(db, { desk, representativeId: id, title });
    if (!clusterId) return null;
    await db.query('UPDATE topics SET cluster_id = $1 WHERE id = $2', [clusterId, id]);
    return clusterId;
  }
  const clusterId = best.cluster_id ?? await createCluster(db, { desk, representativeId: best.id, title: best.title });
  if (!clusterId) return null;
  if (best.cluster_id === null || best.cluster_id === undefined) {
    await db.query('UPDATE topics SET cluster_id = $1 WHERE id = $2', [clusterId, best.id]);
  }
  await db.query('UPDATE topics SET cluster_id = $1 WHERE id = $2', [clusterId, id]);
  return clusterId;
}

export async function loadTopicCluster(db, topicId) {
  const { rows: topics } = await db.query('SELECT * FROM topics WHERE id = $1', [topicId]);
  const topic = topics[0];
  if (!topic) return null;
  const projection = projectDiscoveryTopic(topic);
  if (!topic.cluster_id) return { topic: projection, cluster: null, members: [projection] };
  const { rows: clusters } = await db.query('SELECT * FROM topic_clusters WHERE id = $1', [topic.cluster_id]);
  const cluster = clusters[0] || null;
  const { rows: members } = await db.query('SELECT * FROM topics WHERE cluster_id = $1 ORDER BY id ASC', [topic.cluster_id]);
  return {
    topic: projection,
    cluster: cluster ? { id: cluster.id, desk: cluster.desk, representative_topic_id: cluster.representative_topic_id } : null,
    members: (members.length ? members : [topic]).map(projectDiscoveryTopic),
  };
}
