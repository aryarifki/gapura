import { createArticleReader } from '../scout/article-reader.js';
import { createTopicMaterialService } from '../scout/enrichment.js';
import { materialSufficiency } from '../common/editorial-contract.js';
import { normalizeEditorialInput } from '../common/original-editorial.js';
import { topicEditorialInput } from '../common/source-editorial.js';

function configuredHosts(value = process.env.GAPURA_AI_MATERIAL_HOSTS || '') {
  return new Set(String(value).split(/[\s,;]+/u).map((host) => host.trim().toLowerCase().replace(/\.$/u, '')).filter(Boolean));
}

export function createTopicEditorialInputLoader({ pool, reader = createArticleReader(), allowedHosts = configuredHosts() } = {}) {
  const materials = createTopicMaterialService({ pool, reader });
  async function load(topicId, { refresh = false } = {}) {
    const { rows: [topic] } = await pool.query('SELECT url FROM topics WHERE id=$1', [topicId]);
    if (!topic) throw new Error('topic_not_found');
    let hostname;
    try { hostname = new URL(topic.url).hostname.toLowerCase().replace(/\.$/u, ''); } catch { throw new Error('source_material_url_invalid'); }
    if (!allowedHosts.has(hostname)) {
      throw new Error('source_material_permission_required: Artikel otomatis hanya dapat diproses setelah redaksi memastikan izin penggunaan AI untuk domain sumber. Masukkan catatan fakta dan rujukan yang telah dikurasi secara manual.');
    }
    let record = refresh ? null : await materials.latest(topicId);
    if (record?.material && ['full', 'partial'].includes(record.material.extraction?.status) && materialSufficiency(record.material).sufficient) {
      return topicEditorialInput(record.material);
    }
    record = await materials.enrich(topicId, { refresh: refresh || Boolean(record) });
    return topicEditorialInput(record.material);
  }
  return { load, materials };
}

export async function loadTopicNewsEditorialInput(loader, topicId, input) {
  if (input != null) {
    const normalized = normalizeEditorialInput(input);
    if (normalized.mode === 'explainer' && normalized.facts.length === 0) {
      if (loader && topicId) return loader.load(topicId);
      return normalized;
    }
    return assertNewsEditorialInput(normalized);
  }
  if (!loader || !topicId) throw new Error('source_material_insufficient: Pilih topik dengan materi artikel yang diizinkan atau berikan sedikitnya tiga fakta terkurasi dengan rujukan.');
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
