import { loadTopicCluster } from '../scout/clusters.js';

export function createTopicClusterHandler({ pool }) {
  return async function topicClusterHandler(req, res) {
    const id = String(req.params?.id ?? '');
    if (!/^[1-9]\d*$/u.test(id) || !Number.isSafeInteger(Number(id))) {
      return res.status(400).json({ error: 'ID topik tidak valid.' });
    }
    try {
      const result = await loadTopicCluster(pool, id);
      if (!result) return res.status(404).json({ error: 'Topik tidak ditemukan.' });
      return res.json(result);
    } catch {
      return res.status(503).json({ error: 'Cluster topik tidak dapat dibaca.' });
    }
  };
}
