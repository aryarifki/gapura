import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAttempts, buildChatRequest, parseChatResponse, adaptChatBody, loadProvidersConfig, geminiStageModels } from './providers.js';
import { loadProviderSecrets } from './secret-store.js';
import { markGeminiKey, configuredGeminiKeys, geminiCooldownMs, markProviderCooldown, isProviderCooled } from './llm-pool.js';
import { normalizeJsonResponse } from './json-repair.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AGENT_KEYS = Object.freeze(['scout', 'analis', 'copywriter', 'designer', 'seo', 'studio']);

function assertAgent(agent) {
  if (!AGENT_KEYS.includes(agent)) throw new Error('Nama agen tidak valid.');
}

export function loadAgentsConfig() {
  const configPath = process.env.AGENTS_CONFIG_PATH || path.join(ROOT, 'config/agents.json');
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function loadAgentSkills(agentKey) {
  assertAgent(agentKey);
  const file = path.join(process.env.AGENT_SKILLS_DIR || path.join(ROOT, 'config/skills'), `${agentKey}.skills.md`);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

export function saveAgentSkills(agentKey, content) {
  assertAgent(agentKey);
  if (typeof content !== 'string' || content.length > 64000) throw new Error('Skills harus berupa teks maksimal 64000 karakter.');
  const directory = process.env.AGENT_SKILLS_DIR || path.join(ROOT, 'config/skills');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${agentKey}.skills.md`);
  fs.writeFileSync(`${file}.tmp`, content, { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
  return true;
}

export function agentApiKey(agentCfg = {}, env = process.env, { providers = null, secrets = {} } = {}) {
  if (agentCfg.api_key?.trim()) return agentCfg.api_key.trim();
  const provider = String(agentCfg.provider || 'gemini').toLowerCase();
  const entry = (providers?.providers || {})[provider];
  const envName = entry?.api_key_env;
  if (envName) {
    const managed = secrets?.[envName];
    if (typeof managed === 'string' && managed.trim()) return managed.trim();
    return env[envName]?.trim() || '';
  }
  if (provider === 'gemini') return env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '';
  const providerKey = { openrouter: 'OPENROUTER_API_KEY', groq: 'GROQ_API_KEY', deepseek: 'DEEPSEEK_API_KEY' }[provider];
  return (providerKey && env[providerKey]) || env.OPENAI_API_KEY || '';
}

export function redactProviderError(value, secrets = []) {
  let text = String(value || '');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]')
    .replace(/(x-api-key|x-goog-api-key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/gu, '[REDACTED]')
    .replace(/\bgsk_[0-9A-Za-z_-]{16,}\b/gu, '[REDACTED]')
    .replace(/\bsk-or-v1-[0-9A-Za-z_-]{16,}\b/gu, '[REDACTED]')
    .replace(/("(?:api[_-]?key|key)"\s*:\s*")[^"]+("?)/giu, '$1[REDACTED]$2')
    .slice(0, 500);
}

const MAX_GEMINI_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 16 * 1024;

async function readBoundedBody(response, limit, signal) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > limit) throw new Error('Provider response exceeded the configured size limit.');
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const cancelOnAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  try {
    let text = '';
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => {});
        throw new Error('Provider response exceeded the configured size limit.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
  }
}

async function readBoundedError(response, signal) {
  try {
    const reader = response.body?.getReader?.();
    if (!reader) return (await response.text()).slice(0, MAX_PROVIDER_ERROR_BYTES);
    const decoder = new TextDecoder();
    const cancelOnAbort = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', cancelOnAbort, { once: true });
    try {
      let text = '';
      while (Buffer.byteLength(text, 'utf8') < MAX_PROVIDER_ERROR_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = MAX_PROVIDER_ERROR_BYTES - Buffer.byteLength(text, 'utf8');
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        if (value.byteLength > remaining) { await reader.cancel().catch(() => {}); break; }
      }
      return text + decoder.decode();
    } finally {
      signal?.removeEventListener('abort', cancelOnAbort);
    }
  } catch { return ''; }
}

async function raceBodyTimeout(promise, signal, providerLabel) {
  if (signal.aborted) {
    const error = new Error(`${providerLabel} response body timed out.`);
    error.name = 'TimeoutError';
    error.status = 408;
    error.retryable = true;
    throw error;
  }
  let onAbort;
  const timeout = new Promise((_, reject) => {
    onAbort = () => {
      const error = new Error(`${providerLabel} response body timed out.`);
      error.name = 'TimeoutError';
      error.status = 408;
      error.retryable = true;
      reject(error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([promise, timeout]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

function responseErrorCode(body) {
  let code = '';
  try {
    const parsed = JSON.parse(body);
    code = parsed?.error?.status || parsed?.error?.code || parsed?.error?.details?.[0]?.reason || '';
  } catch { /* Providers may send a plain-text error. */ }
  const text = `${code} ${body}`;
  if (/API_KEY_INVALID|API key not valid|invalid API key/iu.test(text)) return 'API_KEY_INVALID';
  if (/MODEL_NOT_FOUND|model .*not found|unknown model/iu.test(text)) return 'MODEL_NOT_FOUND';
  if (/RESOURCE_EXHAUSTED|rate.?limit|quota/iu.test(text)) return 'RESOURCE_EXHAUSTED';
  if (/PERMISSION_DENIED|permission denied/iu.test(text)) return 'PERMISSION_DENIED';
  if (/UNAUTHENTICATED/iu.test(text)) return 'UNAUTHENTICATED';
  return /^[A-Z][A-Z0-9_]{1,63}$/u.test(String(code)) ? String(code) : 'PROVIDER_ERROR';
}

function parseGeminiRateLimit(rawBody = '') {
  const text = String(rawBody || '');
  const daily = /PerDay|requests per day/iu.test(text);
  const match = text.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/u);
  const retryMs = match ? Math.ceil(Number(match[1]) * 1000) : 0;
  if (daily || retryMs > 300_000) {
    return { daily: true, cooldownMs: Math.min(Math.max(retryMs || 3_600_000, 3_600_000), 24 * 3_600_000) };
  }
  return { daily: false, cooldownMs: retryMs > 0 ? Math.min(Math.max(retryMs, 5_000), 70_000) : 65_000 };
}

async function readGeminiStream(response, signal) {
  if (!String(response.headers?.get?.('content-type') || '').includes('text/event-stream') || !response.body?.getReader) {
    return { streamed: false, payload: await response.json() };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const cancelOnAbort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', cancelOnAbort, { once: true });
  let buffer = '';
  let bytes = 0;
  let text = '';
  let finishReason = null;
  let usageMetadata = null;
  const consumeFrame = (frame) => {
    const data = frame.split(/\r?\n/u).filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart()).join('\n').trim();
    if (!data || data === '[DONE]') return;
    let payload;
    try { payload = JSON.parse(data); }
    catch {
      const error = new Error('Gemini stream contained invalid event data.');
      error.code = 'MALFORMED_STREAM';
      error.skipProvider = true;
      error.retryable = true;
      throw error;
    }
    const candidate = payload?.candidates?.[0];
    if (candidate?.finishReason) finishReason = candidate.finishReason;
    if (payload?.usageMetadata) usageMetadata = payload.usageMetadata;
    for (const part of candidate?.content?.parts || []) {
      if (part?.thought || typeof part?.text !== 'string') continue;
      text += part.text;
      if (Buffer.byteLength(text, 'utf8') > MAX_GEMINI_RESPONSE_BYTES) {
        reader.cancel().catch(() => {});
        const error = new Error('Gemini response exceeded the configured size limit.');
        error.code = 'RESPONSE_TOO_LARGE';
        error.skipProvider = true;
        throw error;
      }
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_GEMINI_RESPONSE_BYTES * 2) {
        await reader.cancel().catch(() => {});
        const error = new Error('Gemini stream exceeded the configured size limit.');
        error.code = 'RESPONSE_TOO_LARGE';
        error.skipProvider = true;
        throw error;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.search(/\r?\n\r?\n/u)) !== -1) {
        const frame = buffer.slice(0, boundary);
        const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/u)?.[0] || '\n\n';
        buffer = buffer.slice(boundary + delimiter.length);
        consumeFrame(frame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeFrame(buffer);
  } catch (error) {
    if (error.code) throw error;
    const wrapped = new Error(error.name === 'TimeoutError' || error.name === 'AbortError' ? 'Gemini stream timed out.' : 'Gemini stream could not be read.');
    wrapped.status = error.name === 'TimeoutError' || error.name === 'AbortError' ? 408 : 0;
    wrapped.retryable = true;
    throw wrapped;
  } finally {
    signal?.removeEventListener('abort', cancelOnAbort);
  }
  if (finishReason === 'MAX_TOKENS') {
    const error = new Error('Gemini stopped at MAX_TOKENS; the truncated response was rejected.');
    error.code = 'MAX_TOKENS';
    error.skipProvider = true;
    throw error;
  }
  if (!text.trim()) {
    const error = new Error('Gemini returned no non-thought text.');
    error.code = 'EMPTY_RESPONSE';
    error.skipProvider = true;
    throw error;
  }
  return { streamed: true, text, finishReason, usageMetadata };
}

async function requestWithAdaptation(attempt, { promptText, policy, jsonMode, fetchImpl, timeoutMs, secrets, onMetadata, responseSchema, stage }) {
  const stream = attempt.kind === 'gemini';
  const stageSchema = /^stage[123]/u.test(stage) ? responseSchema : undefined;
  let request = buildChatRequest(attempt, { prompt: promptText, policy, jsonMode, responseSchema: stageSchema, stream, stage });
  for (let adaptation = 0; adaptation < 2; adaptation++) {
    let response;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      response = await fetchImpl(request.url, {
        method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error',
        signal,
      });
    } catch (error) {
      const wrapped = new Error(`${attempt.providerLabel} could not be reached (${error.name === 'TimeoutError' || error.name === 'AbortError' ? 'timeout' : 'network error'}).`);
      wrapped.status = error.name === 'TimeoutError' || error.name === 'AbortError' ? 408 : 0;
      wrapped.retryable = true;
      throw wrapped;
    }
    if (response.ok) {
      let data;
      try {
        data = await raceBodyTimeout(stream ? readGeminiStream(response, signal) : readBoundedBody(response, MAX_GEMINI_RESPONSE_BYTES, signal)
          .then((text) => ({ streamed: false, payload: JSON.parse(text) })), signal, attempt.providerLabel);
      }
      catch (parseError) {
        if (parseError.code || parseError.status) throw parseError;
        const error = new Error(`${attempt.providerLabel} returned an unreadable response.`);
        error.code = 'INVALID_RESPONSE';
        error.skipProvider = true;
        throw error;
      }
      let text;
      try { text = data.streamed ? data.text : parseChatResponse(attempt.kind, data.payload); }
      catch {
        const error = new Error(`${attempt.providerLabel} returned an empty response.`);
        error.code = 'EMPTY_RESPONSE';
        error.skipProvider = true;
        throw error;
      }
      const usage = data.usageMetadata || data.payload?.usageMetadata || data.payload?.usage || null;
      onMetadata?.({ provider: attempt.providerId, model: attempt.model, fallback: attempt.fallback, status: response.status,
        usage, finish_reason: data.finishReason || data.payload?.candidates?.[0]?.finishReason || null });
      return { value: jsonMode && !stage ? await normalizeJsonResponse(text) : text, status: response.status, usage };
    }
    const raw = await raceBodyTimeout(readBoundedError(response, signal), signal, attempt.providerLabel).catch(() => '');
    const code = responseErrorCode(raw);
    const detail = redactProviderError(raw, secrets);
    const error = new Error(`${attempt.providerLabel} API (${response.status}, ${code})${detail ? `: ${detail}` : '.'}`);
    error.status = response.status;
    error.code = code;
    error.retryable = true;
    if (attempt.poolKey && (code === 'API_KEY_INVALID' || [401, 403].includes(response.status))) error.quarantine = true;
    if (response.status === 400 || response.status === 422) {
      const adapted = attempt.kind === 'gemini' || attempt.kind === 'openai' ? adaptChatBody(request.body, raw) : null;
      if (adapted) {
        request = { ...request, body: adapted };
        continue;
      }
    }
    if ([401, 403].includes(response.status) && !attempt.poolKey) error.skipProvider = true;
    if (response.status === 429) {
      error.retryable = true;
      if (attempt.kind === 'gemini') {
        const rate = parseGeminiRateLimit(raw);
        error.dailyQuota = rate.daily;
        error.cooldownMs = rate.cooldownMs;
      }
    }
    if (![408, 429, 500, 502, 503, 504, 401, 403].includes(response.status) && !error.quarantine) {
      error.retryable = true;
      error.skipProvider = true;
    }
    throw error;
  }
  const error = new Error(`${attempt.providerLabel} rejected the request parameters.`);
  error.code = 'PARAMETER_REJECTED';
  error.skipProvider = true;
  throw error;
}

/** Config/skills overrides allow the settings test to run without writing files. */
export async function callAgentLLM(agentKey, promptText, systemPrompt = '', jsonMode = true, options = {}) {
  assertAgent(agentKey);
  const cfg = options.config || loadAgentsConfig();
  const agent = cfg[agentKey] || {};
  const providers = options.providers || loadProvidersConfig(options.providersPath);
  const secrets = options.secrets ?? (process.env.NODE_ENV === 'test' ? {} : loadProviderSecrets());
  const env = options.env || process.env;
  const geminiLimit = Number.isSafeInteger(options.geminiAttemptLimit) && options.geminiAttemptLimit >= 0 ? options.geminiAttemptLimit : Infinity;
  const buildChain = () => {
    let geminiCount = 0;
    return buildAttempts(agent, providers, { env, secrets, stage: options.stage || '' })
      .filter((attempt) => (attempt.providerId === 'gemini' ? geminiCount++ < geminiLimit : !isProviderCooled(attempt.providerId)));
  };
  let attempts = buildChain();
  // A 429 burst can put every pooled Gemini key into its 65s cooldown, so the
  // chain would be built without any Gemini attempt and fall straight through
  // to Groq/OpenRouter — which cannot serve a ~9k-token staged prompt (413/402).
  // For staged editorial calls, wait out a short RPM cooldown once, but skip
  // dead waits when every key hit its daily RPD limit.
  let dailyBlocked = false;
  if (geminiLimit > 0 && options.stage && String(agent.provider || '').toLowerCase() === 'gemini' && !attempts.some((attempt) => attempt.poolKey)) {
    const poolKeys = configuredGeminiKeys({ env, secrets, inlineKey: agent.api_key });
    const candidateModels = geminiStageModels(agent, { env, secrets, stage: options.stage || '' });
    const rawWaits = candidateModels
      .map((model) => geminiCooldownMs(poolKeys, Date.now(), { model }))
      .filter((ms) => ms > 0);
    const rawWaitMs = rawWaits.length ? Math.min(...rawWaits) : 0;
    const maxWaitMs = Number(options.maxPoolWaitMs ?? 70000);
    if (rawWaitMs > maxWaitMs) dailyBlocked = true;
    else if (rawWaitMs > 0) {
      const sleep = options.sleepImpl || ((ms) => new Promise((resolve) => { setTimeout(resolve, ms); }));
      await sleep(rawWaitMs);
      attempts = buildChain();
    }
  }
  if (!attempts.length) {
    const emptyError = new Error(`Tidak ada provider yang dapat dipakai untuk agen ${agentKey}.`);
    if (dailyBlocked) { emptyError.rateLimited = true; emptyError.dailyQuotaExhausted = true; }
    throw emptyError;
  }
  const skills = options.skills ?? loadAgentSkills(agentKey);
  const policy = [...new Set([
    options.includeAgentPolicy === false ? '' : agent.system_prompt,
    systemPrompt,
    options.includeAgentPolicy === false ? '' : skills,
  ].filter(Boolean))].join('\n\n');
  const fetchImpl = options.fetchImpl || fetch;
  // A per-agent timeout_ms in config/agents.json overrides the 35s default. Large
  // structured editorial stages (stage2_article: ~1700-token prompt, up to 4096
  // output tokens) routinely take 15-35s on Gemini, so the old 35s default timed
  // out mid-generation and fell through to weaker providers.
  const timeoutMs = Number(options.timeoutMs) || Number(agent.timeout_ms) || 35000;
  const secretsToRedact = [...new Set([...attempts.map((attempt) => attempt.apiKey), ...Object.entries(secrets).filter(([name]) => /(?:API_KEY|GEMINI_API_KEYS)/u.test(name)).map(([, value]) => String(value).split(','))].flat())];
  let lastError;
  let index = 0;
  let rateLimited = false;
  let sawDailyQuota = dailyBlocked;
  let sawShortRateLimit = false;
  const transientFailures = new Map();
  const skipProvider = (providerId) => {
    while (attempts[index + 1]?.providerId === providerId) index++;
  };
  const fail = () => {
    if (lastError) {
      lastError.rateLimited = rateLimited;
      lastError.dailyQuotaExhausted = sawDailyQuota && !sawShortRateLimit;
    }
    throw lastError;
  };
  while (index < attempts.length) {
    const attempt = attempts[index];
    if (Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0) attempt.maxTokens = Math.min(attempt.maxTokens, options.maxTokens);
    const startedAt = Date.now();
    try {
      const result = await requestWithAdaptation(attempt, {
        promptText: String(promptText), policy, jsonMode, fetchImpl, timeoutMs,
        secrets: secretsToRedact, onMetadata: options.onMetadata, responseSchema: options.responseSchema, stage: options.stage || '',
      });
      options.onAttempt?.({ stage: options.stage || '', provider: attempt.providerId, model: attempt.model,
        key_slot: attempt.keySlot, fallback: Boolean(attempt.fallback), elapsed_ms: Date.now() - startedAt,
        status: result.status, outcome: 'success' });
      return result.value;
    } catch (error) {
      const safeCode = /^[A-Z][A-Z0-9_]{1,63}$/u.test(String(error.code || '')) ? error.code : null;
      if (error.status === 429) {
        rateLimited = true;
        if (error.dailyQuota) sawDailyQuota = true;
        else sawShortRateLimit = true;
      }
      if (attempt.poolKey && (error.quarantine || [401, 403].includes(error.status))) markGeminiKey(attempt.poolKey, error.quarantine ? 'API_KEY_INVALID' : error.status);
      else if (attempt.poolKey && error.status === 429) markGeminiKey(attempt.poolKey, 429, Date.now(), { model: attempt.model, cooldownMs: error.cooldownMs || 65_000 });
      else if (!attempt.poolKey && error.status === 402 && attempt.providerId !== 'gemini') markProviderCooldown(attempt.providerId, 3_600_000);
      lastError = new Error(redactProviderError(error.message, secretsToRedact));
      options.onAttempt?.({ stage: options.stage || '', provider: attempt.providerId, model: attempt.model,
        key_slot: attempt.keySlot, fallback: Boolean(attempt.fallback), elapsed_ms: Date.now() - startedAt,
        status: Number.isInteger(error.status) && error.status > 0 ? error.status : null,
        outcome: error.status === 429 ? 'rate_limited' : error.quarantine || [401, 403].includes(error.status) ? 'quarantined'
          : error.status === 408 ? 'timeout' : [500, 502, 503, 504].includes(error.status) ? 'transient_error' : 'error',
        ...(safeCode ? { error_code: safeCode } : {}),
      });
      if (!error.retryable && !error.skipProvider) fail();
      if (error.skipProvider) skipProvider(attempt.providerId);
      else if (attempt.poolKey && (error.quarantine || [401, 403, 429].includes(error.status))) {
        // Rotate this unhealthy credential only; leave later pool slots eligible.
      }
      else if (error.status === 408 || [500, 502, 503, 504].includes(error.status) || error.status === 0) {
        const count = (transientFailures.get(attempt.providerId) || 0) + 1;
        transientFailures.set(attempt.providerId, count);
        if (count >= 2) skipProvider(attempt.providerId);
        else if (!attempt.poolKey) index--;
      } else skipProvider(attempt.providerId);
      if (index >= attempts.length - 1) fail();
    }
    index++;
  }
  fail();
}
