import { createArticleReader } from '../scout/article-reader.js';
import { normalizeEditorialInput } from '../common/original-editorial.js';
import { researchTopic } from './research.js';

export function createTopicEditorialInputLoader({ pool, reader = createArticleReader(), researcher = researchTopic } = {}) {
  const CACHE_TTL_MS = 15 * 60 * 1000;
  const documentCache = new Map();
  const inFlight = new Map();
  const fresh = (entry) => entry && Date.now() - entry.at < CACHE_TTL_MS;
  const store = (key, value) => {
    if (!documentCache.has(key) && documentCache.size >= 100) documentCache.delete(documentCache.keys().next().value);
    documentCache.set(key, { ...documentCache.get(key), ...value, at: Date.now() });
  };
  async function load(topicId, { refresh = false, seedFacts = [] } = {}) {
    const key = String(topicId);
    const seeded = Array.isArray(seedFacts) ? seedFacts : [];
    const cacheable = seeded.length === 0;
    const cached = documentCache.get(key);
    if (!refresh && cacheable && fresh(cached) && cached.input) return cached.input;
    if (!refresh && cacheable && inFlight.has(key)) return inFlight.get(key);
    if (refresh) reader.clearCache?.();
    const task = (async () => {
      const { rows: [topic] } = await pool.query('SELECT id,title,url,primary_source,summary,desk,normalized_title FROM topics WHERE id=$1', [topicId]);
      if (!topic) throw new Error('topic_not_found');
      const input = await researcher(topic, { reader, seedFacts: seeded, onDocuments: (documents, legal) => {
        if (cacheable) store(key, { documents, legal });
      } });
      if (cacheable) store(key, { input });
      return input;
    })();
    if (!refresh && cacheable) inFlight.set(key, task);
    try {
      return await task;
    } finally {
      if (inFlight.get(key) === task) inFlight.delete(key);
    }
  }
  return { load, getDocuments(topicId) { const cached = documentCache.get(String(topicId)); return fresh(cached) ? cached.documents : undefined; },
    getLegalContext(topicId) { const cached = documentCache.get(String(topicId)); return fresh(cached) ? cached.legal : undefined; } };
}

export async function loadTopicNewsEditorialInput(loader, topicId, input) {
  if (input != null) {
    const normalized = normalizeEditorialInput(input);
    if (normalized.mode === 'current' && normalized.facts.length) return assertNewsEditorialInput(normalized);
    if (normalized.mode === 'explainer' && normalized.facts.length === 0) {
      if (loader && topicId) return loader.load(topicId);
      return normalized;
    }
    return assertNewsEditorialInput(normalized);
  }
  if (!loader || !topicId) throw new Error('source_material_insufficient: Pilih topik untuk riset web publik atau berikan sedikitnya tiga fakta terkurasi dengan rujukan.');
  return loader.load(topicId);
}

export async function resolveTopicEditorialInput(loader, topicId, input) {
  return loadTopicNewsEditorialInput(loader, topicId, input);
}

export function assertNewsEditorialInput(input) {
  const normalized = normalizeEditorialInput(input);
  if (normalized.mode !== 'current' || normalized.facts.length < 3
    || normalized.facts.some((fact) => fact.text.trim().length < 30)) {
    throw new Error('source_material_insufficient: Berita memerlukan sedikitnya tiga fakta terkurasi yang substantif, masing-masing dengan URL dan nama sumber.');
  }
  return normalized;
}
