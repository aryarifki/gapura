import { loadProvidersConfig } from './providers.js';

const LEGACY_PROVIDERS = ['gemini', 'openai', 'openai-compatible', 'openrouter', 'groq', 'deepseek', 'ollama', 'custom'];

function knownProviders() {
  try {
    return new Set([...LEGACY_PROVIDERS, ...Object.keys(loadProvidersConfig().providers || {})]);
  } catch {
    return new Set(LEGACY_PROVIDERS);
  }
}

export function validateAgent(agentName, agent) {
  const errors = [];
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return [`${agentName}: konfigurasi wajib berupa object.`];
  if (!knownProviders().has(String(agent.provider || 'gemini').toLowerCase())) errors.push(`${agentName}: provider tidak didukung.`);
  if (!String(agent.model || '').trim()) errors.push(`${agentName}: model wajib diisi.`);
  if (agent.endpoint) {
    try {
      const endpoint = new URL(agent.endpoint);
      if (!['https:', 'http:'].includes(endpoint.protocol)) errors.push(`${agentName}: endpoint harus HTTP(S).`);
      if (endpoint.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname)) errors.push(`${agentName}: endpoint remote harus HTTPS.`);
    } catch { errors.push(`${agentName}: endpoint bukan URL valid.`); }
  }
  errors.push(...validateFallbacks(agentName, agent));
  if (agent.timeout_ms !== undefined) {
    const timeout = Number(agent.timeout_ms);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300000) errors.push(`${agentName}: timeout_ms harus bilangan bulat 1000-300000.`);
  }
  if (agentName === 'designer' && Object.hasOwn(agent, 'image_generation')) {
    errors.push(...validateImageGeneration(agent.image_generation));
  }
  return errors;
}

function validateImageGeneration(config) {
  const prefix = 'designer.image_generation:';
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [`${prefix} konfigurasi wajib berupa object.`];
  const errors = [];
  const fields = ['enabled', 'provider', 'model', 'rights_reference', 'timeout_ms'];
  for (const field of Object.keys(config)) {
    if (!fields.includes(field)) errors.push(`${prefix} field tidak didukung (${field}).`);
  }
  if (typeof config.enabled !== 'boolean') errors.push(`${prefix} enabled wajib berupa boolean.`);
  if (config.provider !== 'gemini') errors.push(`${prefix} provider harus gemini.`);
  if (typeof config.model !== 'string' || !config.model.trim()) errors.push(`${prefix} model wajib berupa string yang tidak kosong.`);
  if (config.rights_reference !== 'https://ai.google.dev/gemini-api/terms') errors.push(`${prefix} rights_reference harus https://ai.google.dev/gemini-api/terms.`);
  if (!Number.isInteger(config.timeout_ms) || config.timeout_ms < 1000 || config.timeout_ms > 120000) errors.push(`${prefix} timeout_ms harus bilangan bulat 1000-120000.`);
  return errors;
}

function parseFallbackEntry(value, defaultProvider = 'gemini') {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const slash = text.indexOf('/');
    return slash > 0
      ? { provider: text.slice(0, slash).trim(), model: text.slice(slash + 1).trim() }
      : { provider: defaultProvider, model: text };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { provider: String(value.provider || defaultProvider).trim(), model: String(value.model || '').trim() };
  }
  return null;
}

export function validateFallbacks(agentName, agent) {
  const errors = [];
  let entries = agent.fallback_models;
  if (typeof entries === 'string') entries = entries.split(',').map((item) => item.trim()).filter(Boolean);
  if (entries !== undefined && entries !== null) {
    if (!Array.isArray(entries) || entries.length > 20) errors.push(`${agentName}: fallback_models harus array maksimal 20 entri.`);
    else {
      const providers = knownProviders();
      const agentProvider = String(agent.provider || 'gemini').toLowerCase();
      for (const [index, value] of entries.entries()) {
        const parsed = parseFallbackEntry(value, agentProvider);
        if (!parsed || !parsed.model) { errors.push(`${agentName}: fallback_models #${index + 1} tidak valid.`); continue; }
        if (parsed.provider && !providers.has(parsed.provider)) errors.push(`${agentName}: fallback_models #${index + 1} memakai provider tidak dikenal (${parsed.provider}).`);
      }
    }
  }
  if (agent.fallback_model !== undefined && (typeof agent.fallback_model !== 'string' || !agent.fallback_model.trim() || agent.fallback_model.length > 200)) {
    errors.push(`${agentName}: fallback_model tidak valid.`);
  }
  return errors;
}

export function validateAgentConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['Config harus berupa object.'];

  for (const name of ['analis', 'copywriter', 'designer', 'seo', 'studio']) {
    const agent = config[name];
    if (!agent) { errors.push(`${name}: konfigurasi wajib ada.`); continue; }
    errors.push(...validateAgent(name, agent));
  }

  const analis = config.analis || {};
  const threshold = Number(analis.min_score_threshold);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) errors.push('analis: ambang skor harus bilangan bulat 0-100.');
  const weights = analis.weights || {};
  const values = ['relevance', 'credibility', 'momentum', 'engagement', 'compliance'].map((key) => Number(weights[key]));
  if (values.some((value) => !Number.isInteger(value) || value < 0) || values.reduce((sum, value) => sum + value, 0) !== 100) {
    errors.push('analis: bobot harus bilangan bulat non-negatif dan totalnya 100.');
  }
  const patterns = String(analis.fast_fail_rules || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (const pattern of patterns) {
    try { new RegExp(pattern, 'i'); } catch { errors.push(`analis: pola fast-fail tidak valid (${pattern.slice(0, 40)}).`); }
  }
  const slides = Number(config.copywriter?.slide_count ?? 5);
    if (!Number.isInteger(slides) || slides < 3 || slides > 9) errors.push('copywriter: jumlah slide default harus 3-9.');

  return errors;
}
