import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAttempts, buildChatRequest, parseChatResponse, adaptChatBody, loadProvidersConfig } from './providers.js';
import { loadProviderSecrets } from './secret-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AGENT_KEYS = Object.freeze(['scout', 'analis', 'copywriter', 'designer', 'seo', 'verifikator', 'studio']);

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
    .slice(0, 500);
}

async function requestWithAdaptation(attempt, { promptText, policy, jsonMode, fetchImpl, timeoutMs, secrets, onMetadata }) {
  let request = buildChatRequest(attempt, { prompt: promptText, policy, jsonMode });
  const transient = new Set([408, 429, 500, 502, 503, 504]);
  for (let adaptation = 0; adaptation < 4; adaptation++) {
    let response;
    try {
      response = await fetchImpl(request.url, {
        method: 'POST', headers: request.headers, body: JSON.stringify(request.body), redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const wrapped = new Error(`${attempt.providerLabel} tidak dapat dihubungi: ${error.name || 'network error'}`);
      wrapped.retryable = true;
      throw wrapped;
    }
    if (response.ok) {
      let data;
      try { data = await response.json(); }
      catch {
        const error = new Error(`${attempt.providerLabel} mengembalikan respons non-JSON (kemungkinan halaman blokir atau gateway rusak).`);
        error.retryable = true;
        throw error;
      }
      let text;
      try { text = parseChatResponse(attempt.kind, data); }
      catch (parseError) {
        parseError.retryable = true;
        throw parseError;
      }
      onMetadata?.({ provider: attempt.providerId, model: attempt.model, fallback: attempt.fallback, usage: data.usageMetadata || data.usage || null });
      return text;
    }
    const raw = await response.text();
    const error = new Error(`${attempt.providerLabel} API (${response.status}): ${redactProviderError(raw, secrets)}`);
    error.retryable = transient.has(response.status);
    if (response.status === 400 || response.status === 422) {
      const adapted = attempt.kind === 'gemini' || attempt.kind === 'openai' ? adaptChatBody(request.body, raw) : null;
      if (adapted) {
        request = { ...request, body: adapted };
        continue;
      }
    }
    throw error;
  }
  throw new Error(`${attempt.providerLabel} menolak semua variasi parameter permintaan.`);
}

/** Config/skills overrides allow the settings test to run without writing files. */
export async function callAgentLLM(agentKey, promptText, systemPrompt = '', jsonMode = true, options = {}) {
  assertAgent(agentKey);
  const cfg = options.config || loadAgentsConfig();
  const agent = cfg[agentKey] || {};
  const providers = options.providers || loadProvidersConfig(options.providersPath);
  const secrets = options.secrets ?? (process.env.NODE_ENV === 'test' ? {} : loadProviderSecrets());
  const attempts = buildAttempts(agent, providers, { env: options.env || process.env, secrets });
  if (!attempts.length) throw new Error(`Tidak ada provider yang dapat dipakai untuk agen ${agentKey}.`);
  const skills = options.skills ?? loadAgentSkills(agentKey);
  const policy = [...new Set([agent.system_prompt, systemPrompt, skills].filter(Boolean))].join('\n\n');
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs) || Number(agent.timeout_ms) || 60000;
  const secretsToRedact = attempts.map((attempt) => attempt.apiKey);
  let lastError;

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    try {
      return await requestWithAdaptation(attempt, {
        promptText: String(promptText), policy, jsonMode, fetchImpl, timeoutMs,
        secrets: secretsToRedact, onMetadata: options.onMetadata,
      });
    } catch (error) {
      lastError = new Error(redactProviderError(error.message, secretsToRedact));
      if (!error.retryable || index === attempts.length - 1) throw lastError;
      console.warn(`[LLM] ${agentKey}: ${attempt.providerId}/${attempt.model} gagal sementara; mencoba ${attempts[index + 1].providerId}/${attempts[index + 1].model}.`);
    }
  }
  throw lastError;
}
