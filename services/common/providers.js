import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredGeminiKeys, selectGeminiKeys } from './llm-pool.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PROVIDER_KINDS = Object.freeze(['gemini', 'openai', 'anthropic']);
const PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const MAX_MODELS = 500;

export const BUILTIN_PROVIDERS = Object.freeze({
  gemini: {
    label: 'Google Gemini', kind: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true,
  },
  openai: {
    label: 'OpenAI / ChatGPT', kind: 'openai',
    base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY', enabled: true,
  },
  chatgpt: {
    label: 'ChatGPT (alias OpenAI)', kind: 'openai',
    base_url: 'https://api.openai.com/v1', api_key_env: 'OPENAI_API_KEY', enabled: true,
  },
  anthropic: {
    label: 'Anthropic Claude', kind: 'anthropic',
    base_url: 'https://api.anthropic.com', api_key_env: 'ANTHROPIC_API_KEY', enabled: true,
  },
  deepseek: {
    label: 'DeepSeek', kind: 'openai',
    base_url: 'https://api.deepseek.com/v1', api_key_env: 'DEEPSEEK_API_KEY', enabled: true,
  },
  grok: {
    label: 'xAI Grok', kind: 'openai',
    base_url: 'https://api.x.ai/v1', api_key_env: 'XAI_API_KEY', enabled: true,
  },
  openrouter: {
    label: 'OpenRouter', kind: 'openai',
    base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY', enabled: true,
    headers: { 'HTTP-Referer': 'https://gapura.avenia.my.id', 'X-Title': 'Gapura Media' },
  },
  nvidia: {
    label: 'NVIDIA NIM', kind: 'openai',
    base_url: 'https://integrate.api.nvidia.com/v1', api_key_env: 'NVIDIA_API_KEY', enabled: true,
  },
  groq: {
    label: 'Groq Cloud', kind: 'openai',
    base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true,
    default_model: 'qwen/qwen3.8-27b', max_tokens: 8192,
  },
  xingchi: {
    label: 'Xingchi API', kind: 'openai',
    base_url: 'https://api.xingchiapi.com/v1', api_key_env: 'XINGCHI_API_KEY', enabled: true,
  },
  meta: {
    label: 'Meta Llama API', kind: 'openai',
    base_url: 'https://api.llama.com/v1', api_key_env: 'META_AI_API_KEY', enabled: false,
    notes: 'Meta AI/Llama inference. Berbeda dari Graph API penerbitan Facebook/Instagram.',
  },
  '9router': {
    label: '9Router (isi Base URL)', kind: 'openai',
    base_url: '', api_key_env: 'NINE_ROUTER_API_KEY', enabled: false,
    notes: 'Isi Base URL dari dashboard 9Router sebelum mengaktifkan.',
  },
  agentrouter: {
    label: 'Agent Router (isi Base URL)', kind: 'openai',
    base_url: '', api_key_env: 'AGENT_ROUTER_API_KEY', enabled: false,
    notes: 'Isi Base URL dari dashboard Agent Router sebelum mengaktifkan.',
  },
  custom: {
    label: 'Custom OpenAI-compatible', kind: 'openai',
    base_url: '', api_key_env: 'CUSTOM_API_KEY', enabled: true,
    notes: 'Endpoint diisi per agen atau lewat katalog provider.',
  },
});

export function providersConfigPath() {
  return process.env.PROVIDERS_CONFIG_PATH || path.join(ROOT, 'config/providers.json');
}

export function defaultProvidersConfig() {
  return {
    providers: JSON.parse(JSON.stringify(BUILTIN_PROVIDERS)),
    routing: { fallback_chain: [] },
  };
}

export function loadProvidersConfig(file = providersConfigPath()) {
  if (!fs.existsSync(file)) return defaultProvidersConfig();
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return defaultProvidersConfig(); }
  const merged = {
    providers: { ...JSON.parse(JSON.stringify(BUILTIN_PROVIDERS)), ...(parsed.providers || {}) },
    routing: { fallback_chain: [], ...(parsed.routing || {}) },
  };
  return validateProvidersConfig(merged).length ? defaultProvidersConfig() : merged;
}

export function saveProvidersConfig(config, file = providersConfigPath()) {
  const errors = validateProvidersConfig(config);
  if (errors.length) throw new Error(errors.join(' '));
  const serializable = { providers: config.providers, routing: config.routing || { fallback_chain: [] } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(serializable, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temporary, file);
  return serializable;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value));
    if (!['https:', 'http:'].includes(url.protocol)) return 'URL provider harus HTTP(S).';
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return 'URL provider remote harus HTTPS.';
    if (url.username || url.password) return 'URL provider tidak boleh memuat kredensial.';
    return '';
  } catch {
    return 'URL provider tidak valid.';
  }
}

export function validateProvidersConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return ['Konfigurasi provider harus berupa object.'];
  const entries = config.providers;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return ['Daftar provider harus berupa object.'];
  for (const [id, provider] of Object.entries(entries)) {
    if (!PROVIDER_ID.test(id)) errors.push(`Provider "${id}" memiliki ID tidak valid.`);
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) { errors.push(`Provider ${id}: konfigurasi tidak valid.`); continue; }
    if (typeof provider.label !== 'string' || !provider.label.trim() || provider.label.length > 80) errors.push(`Provider ${id}: label wajib 1-80 karakter.`);
    if (!PROVIDER_KINDS.includes(provider.kind)) errors.push(`Provider ${id}: kind harus gemini, openai, atau anthropic.`);
    if (provider.enabled !== undefined && typeof provider.enabled !== 'boolean') errors.push(`Provider ${id}: enabled harus boolean.`);
    if (!provider.api_key_env || typeof provider.api_key_env !== 'string' || !ENV_NAME.test(provider.api_key_env)) errors.push(`Provider ${id}: api_key_env harus nama environment huruf besar.`);
    if (provider.base_url) {
      const urlError = safeUrl(provider.base_url);
      if (urlError) errors.push(`Provider ${id}: ${urlError}`);
    } else if (provider.enabled !== false && id !== 'custom') {
      errors.push(`Provider ${id}: base_url wajib diisi sebelum diaktifkan.`);
    }
    if (provider.headers !== undefined) {
      if (!provider.headers || typeof provider.headers !== 'object' || Array.isArray(provider.headers)) errors.push(`Provider ${id}: headers harus object.`);
      else for (const [name, value] of Object.entries(provider.headers)) {
        if (!/^[A-Za-z0-9-]{1,64}$/.test(name) || typeof value !== 'string' || /[\r\n]/.test(value) || value.length > 512) errors.push(`Provider ${id}: header tidak valid (${name}).`);
      }
    }
    if (provider.models !== undefined && (!Array.isArray(provider.models) || provider.models.length > MAX_MODELS || provider.models.some((model) => typeof model !== 'string' || !model.trim() || model.length > 200))) {
      errors.push(`Provider ${id}: daftar model tidak valid.`);
    }
    if (provider.default_model !== undefined && (typeof provider.default_model !== 'string' || !provider.default_model.trim() || provider.default_model.length > 200)) {
      errors.push(`Provider ${id}: default_model tidak valid.`);
    }
    if (provider.notes !== undefined && (typeof provider.notes !== 'string' || provider.notes.length > 500)) errors.push(`Provider ${id}: notes maksimal 500 karakter.`);
  }
  const chain = config.routing?.fallback_chain;
  if (chain !== undefined) {
    if (!Array.isArray(chain) || chain.length > 50) errors.push('Fallback chain harus berupa array maksimal 50 entri.');
    else for (const [index, item] of chain.entries()) {
      const parsed = parseFallback(item, '');
      if (!parsed) { errors.push(`Fallback chain #${index + 1} tidak valid.`); continue; }
      if (!entries[parsed.provider]) errors.push(`Fallback chain #${index + 1}: provider "${parsed.provider}" tidak dikenal.`);
      if (!parsed.model) errors.push(`Fallback chain #${index + 1}: model wajib diisi.`);
    }
  }
  return errors;
}

export function parseFallback(value, defaultProvider = '') {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    const slash = text.indexOf('/');
    if (slash > 0) return { provider: text.slice(0, slash), model: text.slice(slash + 1).trim() };
    return { provider: defaultProvider, model: text };
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { provider: String(value.provider || defaultProvider).trim(), model: String(value.model || '').trim() };
  }
  return null;
}

function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

function secretFor(envName, { env, secrets }) {
  const managed = secrets?.[envName];
  if (typeof managed === 'string' && managed.trim()) return managed.trim();
  const fromEnv = env?.[envName];
  return typeof fromEnv === 'string' ? fromEnv.trim() : '';
}

function attemptFrom(providerId, model, config, { env, secrets, endpoint, apiKey, fallback }) {
  const entry = config.providers?.[providerId] || BUILTIN_PROVIDERS[providerId];
  if (!entry && !endpoint) throw new Error(`Provider "${providerId}" tidak dikenal.`);
  if (entry?.enabled === false) throw new Error(`Provider "${providerId}" sedang dinonaktifkan di katalog.`);
  const baseUrl = String(endpoint || entry?.base_url || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error(`Base URL provider "${providerId}" belum diisi.`);
  let hostname;
  try { hostname = new URL(baseUrl).hostname; } catch { throw new Error(`Base URL provider "${providerId}" tidak valid.`); }
  const kind = entry?.kind || (providerId === 'gemini' ? 'gemini' : 'openai');
  const resolvedKey = String(apiKey || '').trim() || secretFor(entry?.api_key_env, { env, secrets });
  if (!resolvedKey && !isLocalHost(hostname)) {
    if (fallback) return null;
    throw new Error(`API Key untuk provider "${providerId}" belum dikonfigurasi.`);
  }
  return {
    providerId, providerLabel: entry?.label || providerId, kind, baseUrl,
    apiKey: resolvedKey, headers: { ...(entry?.headers || {}) }, model,
    fallback, maxTokens: Number(entry?.max_tokens) > 0 ? Number(entry.max_tokens) : 8192,
  };
}

export function geminiStageModels(agent, { env = process.env, secrets = {}, stage = '' } = {}) {
  const primaryStageModel = stage === 'stage1_synthesis'
    ? env.GEMINI_MODEL_SYNTHESIS || secrets.GEMINI_MODEL_SYNTHESIS || agent?.model
    : /^stage[23]/u.test(stage)
      ? env.GEMINI_MODEL_ADAPTER || secrets.GEMINI_MODEL_ADAPTER || agent?.model
      : agent?.model;
  const rawFallbacks = env.GEMINI_FALLBACK_MODELS ?? secrets.GEMINI_FALLBACK_MODELS ?? '';
  const extra = String(rawFallbacks).split(',').map((value) => value.trim()).filter(Boolean);
  return [...new Set([primaryStageModel, ...extra].map((value) => String(value || '').trim()).filter(Boolean))];
}

export function buildAttempts(agent, config, { env = process.env, secrets = {}, stage = '' } = {}) {
  if (!agent || typeof agent !== 'object') throw new Error('Konfigurasi agen tidak valid.');
  const primaryProvider = String(agent.provider || 'gemini').toLowerCase();
  const primaryModel = String(agent.model || '').trim();
  if (!primaryModel) throw new Error('Model agen belum dikonfigurasi.');
  const attempts = [];
  const seen = new Set();
  const push = (attempt) => {
    if (!attempt) return;
    const key = `${attempt.providerId}|${attempt.model}|${attempt.baseUrl}|${attempt.poolKey || attempt.apiKey}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(attempt);
  };
  if (primaryProvider === 'gemini') {
    const keys = configuredGeminiKeys({ env, secrets, inlineKey: agent.api_key });
    const indexedSlots = Object.keys({ ...secrets, ...env })
      .filter((name) => /^GEMINI_API_KEY_\d+$/u.test(name))
      .sort((a, b) => Number(a.slice(15)) - Number(b.slice(15)))
      .map((name, index) => ({ key: secrets[name] || env[name], slot: Number(name.slice(15)) || index + 1 }));
    const models = geminiStageModels(agent, { env, secrets, stage });
    const keyLimit = /^stage[1-4]/u.test(stage) ? 2 : keys.length;
    models.forEach((model, modelIndex) => {
      const selected = selectGeminiKeys(keys, keyLimit, Date.now(), { model });
      selected.forEach((key) => push({ ...attemptFrom('gemini', model, config, { env, secrets, endpoint: agent.endpoint, apiKey: key, fallback: modelIndex > 0 }),
        poolKey: key, keySlot: indexedSlots.find((item) => item.key === key)?.slot }));
    });
  } else push(attemptFrom(primaryProvider, primaryModel, config, { env, secrets, endpoint: agent.endpoint, apiKey: agent.api_key, fallback: false }));

  const freeOnly = String(env.GAPURA_FREE_MODELS_ONLY ?? secrets.GAPURA_FREE_MODELS_ONLY ?? '').toLowerCase() === 'true';
  const fallbacks = [];
  if (primaryProvider === 'gemini') {
    fallbacks.push(`groq/${env.GROQ_MODEL || secrets.GROQ_MODEL || 'qwen/qwen3.8-27b'}`);
    if (!freeOnly) fallbacks.push(`openrouter/${env.OPENROUTER_MODEL || secrets.OPENROUTER_MODEL || 'google/gemini-2.5-flash'}`);
  } else {
    if (Array.isArray(agent.fallback_models)) fallbacks.push(...agent.fallback_models);
    else if (typeof agent.fallback_models === 'string' && agent.fallback_models.trim()) fallbacks.push(...agent.fallback_models.split(',').map((item) => item.trim()).filter(Boolean));
    if (agent.fallback_model) fallbacks.push({ provider: primaryProvider, model: agent.fallback_model });
    if (Array.isArray(config.routing?.fallback_chain)) fallbacks.push(...config.routing.fallback_chain);
  }

  for (const value of fallbacks) {
    const parsed = parseFallback(value, primaryProvider);
    if (!parsed?.provider || !parsed.model) continue;
    if (freeOnly && parsed.provider === 'openrouter') continue;
    if (primaryProvider === 'gemini' && !['groq', 'openrouter'].includes(parsed.provider)) continue;
    try {
      push(attemptFrom(parsed.provider, parsed.model, config, {
        env, secrets, fallback: true,
        endpoint: parsed.provider === primaryProvider ? agent.endpoint : undefined,
        apiKey: parsed.provider === primaryProvider ? agent.api_key : undefined,
      }));
    } catch {
      // A broken optional fallback must not make the primary provider unusable.
    }
  }
  return attempts;
}

export function normalizeChatUrl(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}${/\/v\d+(?:\.\d+)?$/.test(base) ? '' : '/v1'}/chat/completions`;
}

export function normalizeModelsUrl(baseUrl) {
  const base = String(baseUrl).replace(/\/+$/, '');
  if (base.endsWith('/models')) return base;
  if (base.endsWith('/v1beta')) return `${base}/models`;
  return `${base}${/\/v\d+(?:\.\d+)?$/.test(base) ? '' : '/v1'}/models`;
}

function isFlatRowsSchema(schema) {
  const properties = schema?.properties?.rows?.items?.properties;
  return schema?.type === 'object' && schema.properties?.rows?.type === 'array' &&
    schema.properties.rows.items?.type === 'object' && properties && typeof properties === 'object' && !Array.isArray(properties) &&
    Object.values(properties).every((property) => {
      if (!property || !['string', 'number', 'integer', 'boolean'].includes(property.type)) return false;
      return property.enum === undefined || (Array.isArray(property.enum) &&
        property.enum.every((value) => ['string', 'number', 'boolean'].includes(typeof value)));
    });
}

export function buildChatRequest(attempt, { prompt, policy = '', jsonMode = true, responseSchema, stream = false, stage = '' } = {}) {
  const headers = { 'Content-Type': 'application/json', ...attempt.headers };
  if (attempt.kind === 'gemini') {
    if (attempt.apiKey) headers['x-goog-api-key'] = attempt.apiKey;
    const strictSchema = stage ? (/^stage[123]/u.test(stage) && isFlatRowsSchema(responseSchema) ? responseSchema : undefined) : responseSchema;
    return {
      url: `${attempt.baseUrl.replace(/\/v1beta$/, '')}/v1beta/models/${encodeURIComponent(attempt.model)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`,
      headers,
      body: {
        ...(policy ? { systemInstruction: { parts: [{ text: policy }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: attempt.maxTokens,
          // Exact extraction does not benefit from hidden reasoning, and a
          // thinking budget can consume the whole output window before any
          // JSON is emitted (observed as MAX_TOKENS on stage 1).
          ...(stage && /^stage[123]/u.test(stage) && attempt.model !== 'gemini-3.5-flash-lite' ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          ...(jsonMode ? { responseMimeType: 'application/json' } : {}), ...(strictSchema ? { responseJsonSchema: strictSchema } : {}) },
      },
    };
  }
  if (attempt.kind === 'anthropic') {
    const base = attempt.baseUrl.replace(/\/+$/, '');
    const system = [policy, jsonMode ? 'Balas hanya dengan objek JSON valid tanpa markdown.' : ''].filter(Boolean).join('\n\n');
    return {
      url: `${base}${/\/v1$/.test(base) ? '' : '/v1'}/messages`,
      headers: { ...headers, 'anthropic-version': '2023-06-01', ...(attempt.apiKey ? { 'x-api-key': attempt.apiKey } : {}) },
      body: {
        model: attempt.model, max_tokens: attempt.maxTokens, temperature: 0.2,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: String(prompt) }],
      },
    };
  }
  if (attempt.apiKey) headers.Authorization = `Bearer ${attempt.apiKey}`;
  const schemaPrompt = /^stage[123]/u.test(stage) && isFlatRowsSchema(responseSchema)
    ? `\n\nContoh bentuk respons JSON yang wajib diikuti (tanpa markdown): ${JSON.stringify(responseSchema)}`
    : '';
  const chatPolicy = `${policy}${schemaPrompt}`;
  return {
    url: normalizeChatUrl(attempt.baseUrl),
    headers,
    body: {
      model: attempt.model, temperature: 0.2, max_tokens: attempt.maxTokens,
      messages: [...(chatPolicy ? [{ role: 'system', content: chatPolicy }] : []), { role: 'user', content: String(prompt) }],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

/** Removes a request field that a provider rejects, so one model quirk cannot kill the whole fallback chain. */
export function adaptChatBody(body, errorText) {
  const text = String(errorText || '').toLowerCase();
  if (text.includes('response_format') && body.response_format !== undefined) {
    const next = { ...body }; delete next.response_format; return next;
  }
  if (text.includes('temperature') && body.temperature !== undefined) {
    const next = { ...body }; delete next.temperature; return next;
  }
  if (text.includes('max_completion_tokens') && body.max_completion_tokens !== undefined) {
    const next = { ...body }; delete next.max_completion_tokens; return next;
  }
  if (text.includes('max_tokens') && body.max_tokens !== undefined) {
    const next = { ...body }; delete next.max_tokens; next.max_completion_tokens = body.max_tokens; return next;
  }
  if ((text.includes('responsemimetype') || text.includes('response_mime_type')) && body.generationConfig?.responseMimeType) {
    const next = { ...body, generationConfig: { ...body.generationConfig } }; delete next.generationConfig.responseMimeType; return next;
  }
  if ((text.includes('thinking') || text.includes('invalid_argument') || text.includes('invalid argument')) && body.generationConfig?.thinkingConfig !== undefined) {
    const next = { ...body, generationConfig: { ...body.generationConfig } }; delete next.generationConfig.thinkingConfig; return next;
  }
  return null;
}

export function parseChatResponse(kind, data) {
  let text = '';
  if (kind === 'gemini') {
    if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      const error = new Error('Gemini stopped at MAX_TOKENS; the truncated response was rejected.');
      error.code = 'MAX_TOKENS';
      error.retryable = true;
      error.skipProvider = true;
      throw error;
    }
    text = (data?.candidates?.[0]?.content?.parts || [])
      .filter((part) => !part.thought)
      .map((part) => part.text || '').join('');
  } else if (kind === 'anthropic') {
    text = (data?.content || []).filter((part) => part.type === 'text').map((part) => part.text || '').join('');
  } else {
    const message = data?.choices?.[0]?.message;
    const content = message?.content ?? data?.choices?.[0]?.text ?? '';
    text = Array.isArray(content) ? content.map((part) => part.text || '').join('') : String(content || '');
  }
  if (!text.trim()) {
    const reasoning = data?.choices?.[0]?.message?.reasoning || data?.choices?.[0]?.message?.reasoning_content;
    if (reasoning) throw new Error('Model hanya mengembalikan reasoning tanpa jawaban; tambah max_tokens atau pilih model non-reasoning.');
    throw new Error('Provider mengembalikan respons kosong.');
  }
  return text;
}

export function normalizeModelList(kind, payload) {
  let values = [];
  if (kind === 'gemini') {
    values = (payload?.models || [])
      .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
      .map((model) => String(model.name || '').replace(/^models\//, ''));
  } else {
    values = (payload?.data || payload?.models || []).map((model) => typeof model === 'string' ? model : model.id || model.name || '');
  }
  return [...new Set(values.map((value) => String(value).trim()).filter((value) => value && value.length <= 200))];
}
