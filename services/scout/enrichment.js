import { createMaterial } from './material.js';
import { persistTopicMaterial, loadLatestTopicMaterial } from './material-store.js';

export function createTopicMaterialService({ pool, reader } = {}) {
  async function enrich(topicId, { refresh = false } = {}) {
    if (!/^[1-9]\d*$/u.test(String(topicId)) || !Number.isSafeInteger(Number(topicId))) throw new Error('topic_id_invalid');
    const client = await pool.connect();
    try {
      const { rows: [topic] } = await client.query(
        `SELECT t.*, r.source_material FROM topics t LEFT JOIN raw_items r ON r.id = t.raw_item_id WHERE t.id = $1`, [topicId],
      );
      if (!topic) throw new Error('topic_not_found');
      const previous = await loadLatestTopicMaterial(client, topicId);
      if (!refresh && previous?.material?.extraction?.status === 'full') return previous;
      const source = {
        title: topic.title, raw_title: topic.raw_title || topic.title,
        url: topic.url, publisher_url: topic.publisher_url, source: topic.primary_source,
        type: topic.source_kind || 'feed', summary: topic.summary || '',
        content: topic.summary || '', content_kind: 'feed_summary',
        published_at: topic.source_published_at?.toISOString?.() || topic.source_published_at || null,
        updated_at: topic.source_updated_at?.toISOString?.() || topic.source_updated_at || null,
        image_url: topic.image_url || null,
      };
      // Prefer a real article URL already resolved in a stored snapshot; never
      // replace an aggregator article identity with the publisher's homepage.
      const target = previous?.material?.article_url || topic.source_material?.article_url || topic.url;
      const document = await reader.read({ url: target, publisher: topic.primary_source || '', publisherUrl: topic.publisher_url || '', refresh });
      const material = createMaterial(source, { document });
      await client.query('BEGIN');
      try {
        const saved = await persistTopicMaterial(client, topicId, material);
        await client.query('UPDATE topics SET material_status = $2 WHERE id = $1', [topicId, material.extraction.status]);
        await client.query('COMMIT');
        return { ...saved, material };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } finally { client.release(); }
  }

  async function latest(topicId) {
    const client = await pool.connect();
    try {
      const { rows } = await client.query('SELECT id FROM topics WHERE id = $1', [topicId]);
      if (!rows.length) throw new Error('topic_not_found');
      return loadLatestTopicMaterial(client, topicId);
    } finally { client.release(); }
  }

  return { enrich, latest };
}
