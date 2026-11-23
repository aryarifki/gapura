import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adaptChatBody,
  buildAttempts,
  buildChatRequest,
  normalizeModelList,
  parseChatResponse,
  validateProvidersConfig,
} from '../providers.js';
import { configuredGeminiKeys, markGeminiKey, resetGeminiPool } from '../llm-pool.js';

const providers = {
  providers: {
    gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
    groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true },
    openrouter: { label: 'OpenRouter', kind: 'openai', base_url: 'https://openrouter.ai/api/v1', api_key_env: 'OPENROUTER_API_KEY', enabled: true },
    anthropic: { label: 'Anthropic', kind: 'anthropic', base_url: 'https://api.anthropic.com', api_key_env: 'ANTHROPIC_API_KEY', enabled: true },
    disabled: { label: 'Off', kind: 'openai', base_url: 'https://off.example/v1', api_key_env: 'OFF_KEY', enabled: false },
  },
  routing: { fallback_chain: ['groq/llama-3.3-70b-versatile', 'openrouter/google/gemini-2.5-flash'] },
};

const env = { GEMINI_API_KEY: 'gemini-env', GROQ_API_KEY: 'groq-env', OPENROUTER_API_KEY: 'openrouter-env', ANTHROPIC_API_KEY: 'anthropic-env' };

test('Gemini routes only through its key pool, Groq, then OpenRouter', () => {
  resetGeminiPool();
  const attempts = buildAttempts({
    provider: 'gemini', model: 'gemini-3-flash-preview', api_key: 'inline-key',
    fallback_models: ['groq/llama-3.3-70b-versatile', { provider: 'anthropic', model: 'claude-sonnet-4-5' }],
  }, providers, { env });
  assert.deepEqual(attempts.map((attempt) => `${attempt.providerId}/${attempt.model}`), [
    'gemini/gemini-3-flash-preview',
    'groq/qwen/qwen3.8-27b',
    'openrouter/google/gemini-2.5-flash',
  ]);
  assert.equal(attempts[0].apiKey, 'inline-key');
  assert.equal(attempts[1].apiKey, 'groq-env');
  assert.deepEqual(attempts[1].headers, {});
  assert.equal(attempts[2].apiKey, 'openrouter-env');
});

test('deduplicates the legacy comma-separated pool against all six indexed slots', () => {
  resetGeminiPool();
  const keys = configuredGeminiKeys({ env: { GEMINI_API_KEY: 'slot-1', GEMINI_API_KEYS: 'slot-1,slot-2,slot-3,slot-4,slot-5' },
    secrets: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`GEMINI_API_KEY_${index + 1}`, `slot-${index + 1}`])) });
  assert.deepEqual(keys, ['slot-1', 'slot-2', 'slot-3', 'slot-4', 'slot-5', 'slot-6']);
});

test('advances the Gemini primary slot once per build, not once per eligible key', () => {
  resetGeminiPool();
  const options = { env: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`GEMINI_API_KEY_${index + 1}`, `slot-${index + 1}`])) };
  const agent = { provider: 'gemini', model: 'gemini-2.5-flash' };
  const first = buildAttempts(agent, providers, options).filter((attempt) => attempt.poolKey).map((attempt) => attempt.keySlot);
  const second = buildAttempts(agent, providers, options).filter((attempt) => attempt.poolKey).map((attempt) => attempt.keySlot);
  assert.deepEqual(first, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(second, [2, 3, 4, 5, 6, 1]);
});

test('uses the configured model for ordinary calls and stage-specific Gemini models for S1/S2/S3', () => {
  resetGeminiPool();
  const agent = { provider: 'gemini', model: 'configured-gemini-model' };
  const options = { env: { GEMINI_API_KEY_1: 'secret', GEMINI_MODEL_SYNTHESIS: 'gemini-2.5-flash', GEMINI_MODEL_ADAPTER: 'gemini-2.5-flash-lite' } };
  assert.equal(buildAttempts(agent, providers, options)[0].model, 'configured-gemini-model');
  assert.equal(buildAttempts(agent, providers, { ...options, stage: 'stage1_synthesis' })[0].model, 'gemini-2.5-flash');
  assert.equal(buildAttempts(agent, providers, { ...options, stage: 'stage2_article' })[0].model, 'gemini-2.5-flash-lite');
});

test('prefers a reloadable secret store over the process environment', () => {
  const attempts = buildAttempts({ provider: 'groq', model: 'llama-3.3-70b-versatile' }, providers, {
    env, secrets: { GROQ_API_KEY: 'ui-managed-key' },
  });
  assert.equal(attempts[0].apiKey, 'ui-managed-key');
});

test('skips disabled fallbacks but refuses a disabled primary provider', () => {
  const attempts = buildAttempts({
    provider: 'groq', model: 'llama-3.3-70b-versatile',
    fallback_models: ['disabled/off-model', 'openrouter/google/gemini-2.5-flash'],
  }, { ...providers, routing: { fallback_chain: [] } }, { env: { ...env, OFF_KEY: 'x' } });
  assert.deepEqual(attempts.map((attempt) => attempt.providerId), ['groq', 'openrouter']);
  assert.throws(() => buildAttempts({ provider: 'disabled', model: 'off-model' }, providers, { env }), /dinonaktifkan/);
});

test('supports a legacy custom endpoint with an inline key even without a registry entry', () => {
  const attempts = buildAttempts({ provider: 'custom', endpoint: 'http://127.0.0.1:9999/v1', model: 'fixture-model', api_key: 'fixture-key' }, { providers: {}, routing: {} }, { env: {} });
  assert.equal(attempts[0].baseUrl, 'http://127.0.0.1:9999/v1');
  assert.equal(attempts[0].kind, 'openai');
  assert.equal(attempts[0].apiKey, 'fixture-key');
});

test('builds Gemini, OpenAI-compatible, and Anthropic requests with the right auth transport', () => {
  const gemini = buildChatRequest(buildAttempts({ provider: 'gemini', model: 'gemini-2.5-flash' }, providers, { env })[0], { prompt: 'hello', policy: 'policy', jsonMode: true });
  assert.match(gemini.url, /v1beta\/models\/gemini-2\.5-flash:generateContent$/);
  assert.equal(gemini.headers['x-goog-api-key'], 'gemini-env');
  assert.equal(gemini.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(gemini.body.systemInstruction.parts[0].text, 'policy');

  const openai = buildChatRequest(buildAttempts({ provider: 'groq', model: 'llama-3.3-70b-versatile' }, providers, { env })[0], { prompt: 'hello', policy: 'policy', jsonMode: true });
  assert.equal(openai.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(openai.headers.Authorization, 'Bearer groq-env');
  assert.equal(openai.headers['User-Agent'], undefined);
  assert.equal(openai.body.response_format.type, 'json_object');

  const anthropic = buildChatRequest(buildAttempts({ provider: 'anthropic', model: 'claude-sonnet-4-5' }, providers, { env })[0], { prompt: 'hello', policy: 'policy', jsonMode: true });
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropic.headers['x-api-key'], 'anthropic-env');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropic.body.max_tokens, 8192);
  assert.match(anthropic.body.system, /policy/);
});

test('Gemini streams by explicit opt-in and applies zero thinking to S1/S2/S3', () => {
  const attempt = { kind: 'gemini', baseUrl: 'https://example.com', model: 'gemini-2.5-flash', maxTokens: 256 };
  const schema = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' } } } } }, required: ['rows'] };
  const legacy = buildChatRequest(attempt, { prompt: 'legacy' });
  assert.match(legacy.url, /:generateContent$/u);
  const s1 = buildChatRequest(attempt, { prompt: 'S1', stream: true, stage: 'stage1_synthesis', responseSchema: schema });
  assert.match(s1.url, /:streamGenerateContent\?alt=sse$/u);
  assert.deepEqual(s1.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.equal(s1.body.generationConfig.responseJsonSchema.type, 'object');
  const s3 = buildChatRequest(attempt, { prompt: 'S3', stream: true, stage: 'stage3a_carousel', responseSchema: schema });
  assert.deepEqual(s3.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  const legacyStage = buildChatRequest(attempt, { prompt: 'S4', stage: 'stage4_review', responseSchema: { type: 'object' } });
  assert.equal(legacyStage.body.generationConfig.responseJsonSchema, undefined);
  const nestedSchema = buildChatRequest(attempt, { prompt: 'S2', stage: 'stage2_article', responseSchema: {
    type: 'object', properties: { rows: { type: 'array', items: { type: 'object', properties: { nested: { type: 'object' } } } } },
  } });
  assert.equal(nestedSchema.body.generationConfig.responseJsonSchema, undefined);
});

test('normalizes model catalogs from all three wire formats', () => {
  assert.deepEqual(normalizeModelList('gemini', { models: [
    { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] },
  ] }), ['gemini-2.5-flash']);
  assert.deepEqual(normalizeModelList('openai', { data: [{ id: 'a' }, { id: 'b' }] }), ['a', 'b']);
  assert.deepEqual(normalizeModelList('anthropic', { data: [{ id: 'claude-x' }] }), ['claude-x']);
});

test('parses responses and ignores Gemini thought parts', () => {
  assert.equal(parseChatResponse('gemini', { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"ok":true}' }] } }] }), '{"ok":true}');
  assert.equal(parseChatResponse('openai', { choices: [{ message: { content: '{"ok":true}' } }] }), '{"ok":true}');
  assert.equal(parseChatResponse('anthropic', { content: [{ type: 'text', text: '{"ok":' }, { type: 'text', text: 'true}' }] }), '{"ok":true}');
  assert.throws(() => parseChatResponse('openai', { choices: [{ message: { content: '', reasoning: 'only reasoning' } }] }), /reasoning/i);
});

test('rejects unsafe provider URLs, missing keys, and dangling fallback references', () => {
  const unsafe = { providers: { bad: { label: 'Bad', kind: 'openai', base_url: 'http://remote.example/v1', api_key_env: 'bad-key', enabled: true } }, routing: { fallback_chain: ['missing/model'] } };
  const errors = validateProvidersConfig(unsafe);
  assert.match(errors.join(' '), /HTTPS/);
  assert.match(errors.join(' '), /api_key_env/);
  assert.match(errors.join(' '), /tidak dikenal/);
});

test('GEMINI_FALLBACK_MODELS skips a cooled primary Gemini model and free-only mode drops paid OpenRouter', () => {
  resetGeminiPool();
  const poolEnv = {
    GEMINI_API_KEY_1: 'k1',
    GEMINI_API_KEY_2: 'k2',
    GEMINI_MODEL_ADAPTER: 'gemini-3-flash-preview',
    GEMINI_FALLBACK_MODELS: 'gemini-3.5-flash,gemini-3.5-flash-lite',
    GROQ_API_KEY: 'groq-k',
    OPENROUTER_API_KEY: 'or-k',
    GAPURA_FREE_MODELS_ONLY: 'true',
  };
  markGeminiKey('k1', 429, Date.now(), { model: 'gemini-3-flash-preview', cooldownMs: 3_600_000 });
  markGeminiKey('k2', 429, Date.now(), { model: 'gemini-3-flash-preview', cooldownMs: 3_600_000 });
  const attempts = buildAttempts({ provider: 'gemini', model: 'gemini-3.5-flash-lite' }, providers, { env: poolEnv, stage: 'stage2_article' });
  assert.deepEqual(attempts.map((a) => `${a.providerId}/${a.model}`), [
    'gemini/gemini-3.5-flash',
    'gemini/gemini-3.5-flash',
    'gemini/gemini-3.5-flash-lite',
    'gemini/gemini-3.5-flash-lite',
    'groq/qwen/qwen3.8-27b',
  ]);
  assert.equal(attempts.some((a) => a.providerId === 'openrouter'), false);
});

test('omits thinkingConfig on gemini-3.5-flash-lite and adaptChatBody strips thinkingConfig on INVALID_ARGUMENT', () => {
  const liteReq = buildChatRequest({ kind: 'gemini', baseUrl: 'https://example.com', model: 'gemini-3.5-flash-lite', maxTokens: 256 }, {
    prompt: 'S1', stream: true, stage: 'stage1_synthesis',
  });
  assert.equal(liteReq.body.generationConfig.thinkingConfig, undefined);
  const stdReq = buildChatRequest({ kind: 'gemini', baseUrl: 'https://example.com', model: 'gemini-3.1-flash-lite', maxTokens: 256 }, {
    prompt: 'S1', stream: true, stage: 'stage1_synthesis',
  });
  assert.deepEqual(stdReq.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  const adapted = adaptChatBody(stdReq.body, '{"error":{"status":"INVALID_ARGUMENT","message":"Request contains an invalid argument."}}');
  assert.equal(adapted.generationConfig.thinkingConfig, undefined);
});
