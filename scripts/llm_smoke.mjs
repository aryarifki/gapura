#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredGeminiKeys } from '../services/common/llm-pool.js';
import { loadProviderSecrets } from '../services/common/secret-store.js';

const secrets = loadProviderSecrets();
const env = process.env;
const timeoutMs = Math.max(1, Math.min(1000, Number(process.env.GAPURA_LLM_SMOKE_TIMEOUT_MS) || 1000));
const model = 'gemini-2.5-flash';
const groqModel = process.env.GAPURA_LLM_SMOKE_GROQ_MODEL || secrets.GROQ_MODEL || 'llama-3.3-70b-versatile';
const openrouterModel = process.env.GAPURA_LLM_SMOKE_OPENROUTER_MODEL || secrets.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const keys = configuredGeminiKeys({ env, secrets });
const indexed = Object.keys({ ...secrets, ...env }).filter((name) => /^GEMINI_API_KEY_\d+$/u.test(name))
  .sort((a, b) => Number(a.slice(15)) - Number(b.slice(15)))
  .map((name, index) => ({ key: secrets[name] || env[name], slot: Number(name.slice(15)) || index + 1 }));

function safeErrorBody(body, headers = {}) {
  let value = String(body || '');
  try {
    const payload = JSON.parse(value);
    value = String(payload?.error?.message || payload?.error?.status || payload?.message || value);
  } catch { /* Keep the body only when it is not JSON. */ }
  for (const secret of [headers['x-goog-api-key'], headers['x-api-key'], headers.Authorization?.replace(/^Bearer\s+/iu, '')].filter(Boolean)) {
    value = value.split(secret).join('[REDACTED]');
  }
  return value.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/giu, '$1[REDACTED]')
    .replace(/([?&]key=)[^&\s"']+/giu, '$1[REDACTED]')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/gu, '[REDACTED]')
    .replace(/\bgsk_[0-9A-Za-z_-]{16,}\b/gu, '[REDACTED]')
    .replace(/\bsk-or-v1-[0-9A-Za-z_-]{16,}\b/gu, '[REDACTED]')
    .replace(/\b\d{8,}\b/gu, '[REDACTED_PROJECT_ID]')
    .replace(/https?:\/\/\S+/giu, '[URL]')
    .slice(0, 1000);
}

function classify(status, body = '') {
  let payload = {};
  try { payload = JSON.parse(body); } catch { /* Do not expose provider error text. */ }
  const codeValue = payload?.error?.status || payload?.error?.code || payload?.error?.details?.[0]?.reason || '';
  const code = String(codeValue).toUpperCase();
  const text = `${code} ${payload?.error?.message || ''}`;
  if (/API_KEY_INVALID|API KEY NOT VALID|INVALID API KEY/u.test(text)) return { outcome: 'invalid_key', error_code: 'API_KEY_INVALID' };
  if (/MODEL_NOT_FOUND|MODEL .*NOT FOUND|UNKNOWN MODEL/u.test(text)) return { outcome: 'model_unavailable', error_code: code || 'MODEL_NOT_FOUND' };
  if (/NOT_FOUND/u.test(code)) return { outcome: status === 404 ? 'model_unavailable_or_not_found' : 'not_found_or_model_unavailable', error_code: code };
  if (status === 401) return { outcome: 'authentication_error', error_code: code || 'UNAUTHENTICATED' };
  if (status === 403) return { outcome: 'permission_or_project_error', error_code: code || 'PERMISSION_DENIED' };
  if (status === 429) return { outcome: 'rate_limited', error_code: code || 'RESOURCE_EXHAUSTED' };
  return { outcome: 'http_error', error_code: /^[A-Z][A-Z0-9_]{1,63}$/u.test(code) ? code : `HTTP_${status}` };
}

async function boundedText(response, signal, maxBytes = 128 * 1024) {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let text = '';
  const abort = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (Buffer.byteLength(text) < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - Buffer.byteLength(text);
      text += decoder.decode(value.subarray(0, remaining), { stream: true });
      if (value.byteLength > remaining) { await reader.cancel().catch(() => {}); break; }
    }
    return text + decoder.decode();
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

async function request({ target, slot, model: requestModel, url, method = 'POST', headers, body, list = false, stream = false }) {
  const started = Date.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const requestHeaders = { ...(headers || {}) };
    if (target.startsWith('ai_studio_') || target.startsWith('vertex_express_')) {
      const suffix = process.env.GAPURA_LLM_SMOKE_USER_AGENT || '';
      if (suffix) requestHeaders['User-Agent'] = [requestHeaders['User-Agent'], suffix].filter(Boolean).join(' ');
    }
    const response = await fetch(url, { method, headers: requestHeaders, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal });
    const raw = await boundedText(response, signal);
    if (!response.ok) return { target, ...(slot ? { key_slot: slot } : {}), model: requestModel, ...classify(response.status, raw),
      status: response.status, error_detail: safeErrorBody(raw, requestHeaders), elapsed_ms: Date.now() - started };
    if (list) {
      let payload = {};
      try { payload = JSON.parse(raw); } catch { /* A 2xx response without JSON does not verify the catalog. */ }
      const models = (payload.models || []).map((entry) => String(entry.name || '').replace(/^models\//u, ''));
      const found = payload.models?.find((entry) => String(entry.name || '').replace(/^models\//u, '') === requestModel);
      return { target, key_slot: slot, model: requestModel, outcome: 'ok', status: response.status,
        model_list_has_requested_model: models.includes(requestModel),
        model_entry: found ? { name: found.name, supported_generation_methods: found.supportedGenerationMethods || [] } : null,
        ...(found ? { supported_generation: (found.supportedGenerationMethods || []).includes('generateContent') } : {}), elapsed_ms: Date.now() - started };
    }
    const payloads = [];
    if (stream || response.headers.get('content-type')?.includes('text/event-stream')) {
      for (const line of raw.split(/\r?\n/u)) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try { payloads.push(JSON.parse(data)); } catch { /* Only classify recognized SSE JSON. */ }
      }
    } else {
      try { payloads.push(JSON.parse(raw)); } catch { /* HTTP success with a non-JSON body still confirms status. */ }
    }
    const hasOutput = payloads.some((payload) => payload.candidates?.length || payload.choices?.length);
    const finishReason = payloads.map((payload) => payload.candidates?.[0]?.finishReason).find(Boolean);
    return { target, ...(slot ? { key_slot: slot } : {}), model: requestModel,
      outcome: finishReason === 'MAX_TOKENS' ? 'truncated_response' : hasOutput ? 'ok' : 'ok_no_json_body', status: response.status,
      ...(finishReason ? { finish_reason: finishReason } : {}), elapsed_ms: Date.now() - started };
  } catch (error) {
    const timeout = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return { target, ...(slot ? { key_slot: slot } : {}), model: requestModel,
      outcome: timeout ? 'timeout_unverified' : 'network_error', error_code: timeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      status: null, elapsed_ms: Date.now() - started };
  }
}

const geminiBody = { contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
  generationConfig: { maxOutputTokens: 8, temperature: 0, thinkingConfig: { thinkingBudget: 0 } } };
const results = [];
for (const key of keys) {
  const slot = indexed.find((item) => item.key === key)?.slot;
  if (!slot) continue;
  const auth = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  const encodedModel = encodeURIComponent(model);
  const [catalog, aiStudio, vertex] = await Promise.all([
    request({ target: 'ai_studio_models', slot, model, url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
      method: 'GET', headers: { 'x-goog-api-key': key, Accept: 'application/json' }, list: true }),
    request({ target: 'ai_studio_inference', slot, model, url: `https://generativelanguage.googleapis.com/v1beta/models/${encodedModel}:streamGenerateContent?alt=sse`, headers: auth, body: geminiBody, stream: true }),
    request({ target: 'vertex_express_inference', slot, model, url: `https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${encodedModel}:generateContent`, headers: auth, body: geminiBody }),
  ]);
  results.push(catalog, aiStudio, vertex);
}

for (const [provider, apiKey, requestModel, url, headers, body] of [
  ['groq', secrets.GROQ_API_KEY || env.GROQ_API_KEY, groqModel, 'https://api.groq.com/openai/v1/chat/completions', {},
    { model: groqModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, temperature: 0 }],
  ['openrouter', secrets.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY, openrouterModel, 'https://openrouter.ai/api/v1/chat/completions',
    { 'HTTP-Referer': 'https://gapura.avenia.my.id', 'X-Title': 'Gapura Media' },
    { model: openrouterModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 8, temperature: 0 }],
]) {
  if (!apiKey) {
    results.push({ target: `${provider}_inference`, model: requestModel, outcome: 'not_configured', status: null });
    continue;
  }
  results.push(await request({ target: `${provider}_inference`, model: requestModel, url, headers: {
    ...headers, 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`,
  }, body }));
}

const report = { ran_at: new Date().toISOString(), timeout_ms: timeoutMs, requested_gemini_model: model, results };
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1 && process.argv[outputIndex + 1]) {
  const outputPath = path.resolve(process.argv[outputIndex + 1]);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  const temporary = `${outputPath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, outputPath);
  fs.chmodSync(outputPath, 0o600);
}
console.log(JSON.stringify(report, null, 2));
