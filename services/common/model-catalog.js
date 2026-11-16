import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeModelList, normalizeModelsUrl } from './providers.js';
import { redactProviderError } from './llm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_TIMEOUT_MS = 20000;

export function catalogCachePath() {
  return process.env.MODELS_CACHE_PATH || path.join(ROOT, 'config/models.cache.json');
}

export function loadModelCache(file = catalogCachePath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { providers: {} };
    return { providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {} };
  } catch {
    return { providers: {} };
  }
}

function saveModelCache(cache, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporary, file);
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

export function resolveProviderKey(entry, { env = process.env, secrets = {} } = {}) {
  const managed = entry?.api_key_env ? secrets?.[entry.api_key_env] : '';
  if (typeof managed === 'string' && managed.trim()) return managed.trim();
  const fromEnv = entry?.api_key_env ? env?.[entry.api_key_env] : '';
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

export function buildModelsRequest(entry) {
  const base = String(entry.base_url || '').replace(/\/+$/, '');
  const headers = { Accept: 'application/json', ...(entry.headers || {}) };
  if (entry.kind === 'gemini') {
    if (entry.apiKey) headers['x-goog-api-key'] = entry.apiKey;
    return { url: `${base.replace(/\/v1beta$/, '')}/v1beta/models`, headers };
  }
  if (entry.kind === 'anthropic') {
    if (entry.apiKey) headers['x-api-key'] = entry.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return { url: `${base}${/\/v1$/.test(base) ? '' : '/v1'}/models`, headers };
  }
  if (entry.apiKey) headers.Authorization = `Bearer ${entry.apiKey}`;
  return { url: normalizeModelsUrl(base), headers };
}

async function refreshOne(providerId, config, { env, secrets, fetchImpl, timeoutMs }) {
  const entry = config.providers?.[providerId];
  if (!entry) throw new Error(`Provider "${providerId}" tidak dikenal.`);
  if (entry.enabled === false) return { models: null, error: 'Provider dinonaktifkan di katalog.' };
  const base = String(entry.base_url || '').replace(/\/+$/, '');
  if (!base) return { models: null, error: 'Base URL provider belum diisi.' };
  let hostname = '';
  try { hostname = new URL(base).hostname; } catch { return { models: null, error: 'Base URL provider tidak valid.' }; }
  const apiKey = resolveProviderKey(entry, { env, secrets });
  if (!apiKey && !isLocalHost(hostname)) return { models: null, error: `API Key (${entry.api_key_env}) belum dikonfigurasi.` };
  const request = buildModelsRequest({ providerId, ...entry, apiKey });
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: 'GET', headers: request.headers, redirect: 'error',
      signal: AbortSignal.timeout(Number(timeoutMs) || DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    return { models: null, error: redactProviderError(`${entry.label || providerId} tidak dapat dihubungi: ${error.name || 'network error'}`, [apiKey]) };
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    return { models: null, error: redactProviderError(`${entry.label || providerId} API (${response.status}): ${body}`, [apiKey]) };
  }
  let payload;
  try { payload = await response.json(); }
  catch { return { models: null, error: `${entry.label || providerId} mengembalikan respons non-JSON.` }; }
  const models = normalizeModelList(entry.kind, payload);
  if (!models.length) return { models: [], error: 'Provider tidak mengembalikan model yang bisa dipakai chat.' };
  return { models, error: null };
}

/** Refreshes one provider or every enabled provider and persists the catalog cache. */
export async function refreshModels({ providerId = null, config, env = process.env, secrets = {}, fetchImpl = fetch, cachePath = catalogCachePath(), timeoutMs } = {}) {
  const cache = loadModelCache(cachePath);
  const ids = providerId ? [providerId] : Object.keys(config.providers || {});
  if (providerId && !config.providers?.[providerId]) throw new Error(`Provider "${providerId}" tidak dikenal.`);
  for (const id of ids) {
    const outcome = await refreshOne(id, config, { env, secrets, fetchImpl, timeoutMs });
    const previous = cache.providers[id] || {};
    cache.providers[id] = {
      models: outcome.models === null ? previous.models || [] : outcome.models,
      fetched_at: outcome.error && outcome.models === null ? previous.fetched_at || null : new Date().toISOString(),
      error: outcome.error,
    };
  }
  saveModelCache(cache, cachePath);
  return cache;
}

export function providerInventory(config, { env = process.env, secrets = {}, cache = loadModelCache() } = {}) {
  return Object.entries(config.providers || {}).map(([id, entry]) => {
    const cached = cache.providers?.[id] || {};
    return {
      id,
      label: entry.label || id,
      kind: entry.kind,
      base_url: entry.base_url || '',
      enabled: entry.enabled !== false,
      api_key_env: entry.api_key_env,
      key_configured: Boolean(resolveProviderKey(entry, { env, secrets })),
      default_model: entry.default_model || '',
      max_tokens: Number(entry.max_tokens) > 0 ? Number(entry.max_tokens) : 8192,
      notes: entry.notes || '',
      models: Array.isArray(cached.models) ? cached.models : [],
      model_count: Array.isArray(cached.models) ? cached.models.length : 0,
      fetched_at: cached.fetched_at || null,
      error: cached.error || null,
    };
  }).sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.label.localeCompare(right.label));
}
