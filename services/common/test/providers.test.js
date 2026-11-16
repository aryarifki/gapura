import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttempts,
  buildChatRequest,
  normalizeModelList,
  parseChatResponse,
  validateProvidersConfig,
} from '../providers.js';

const providers = {
  providers: {
    gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
    masb: { label: 'MASB', kind: 'openai', base_url: 'https://ai.masb.web.id/v1', api_key_env: 'MASB_API_KEY', enabled: true, headers: { 'User-Agent': 'browser' } },
    anthropic: { label: 'Anthropic', kind: 'anthropic', base_url: 'https://api.anthropic.com', api_key_env: 'ANTHROPIC_API_KEY', enabled: true },
    disabled: { label: 'Off', kind: 'openai', base_url: 'https://off.example/v1', api_key_env: 'OFF_KEY', enabled: false },
  },
  routing: { fallback_chain: ['masb/qwen3.8-27b', 'gemini/gemini-2.5-flash'] },
};

const env = { GEMINI_API_KEY: 'gemini-env', MASB_API_KEY: 'masb-env', ANTHROPIC_API_KEY: 'anthropic-env' };

test('builds primary, agent fallback, and global fallback attempts without duplicates', () => {
  const attempts = buildAttempts({
    provider: 'gemini', model: 'gemini-3-flash-preview', api_key: 'inline-key',
    fallback_models: ['masb/qwen3.8-27b', { provider: 'anthropic', model: 'claude-sonnet-4-5' }],
  }, providers, { env });
  assert.deepEqual(attempts.map((attempt) => `${attempt.providerId}/${attempt.model}`), [
    'gemini/gemini-3-flash-preview',
    'masb/qwen3.8-27b',
    'anthropic/claude-sonnet-4-5',
    'gemini/gemini-2.5-flash',
  ]);
  assert.equal(attempts[0].apiKey, 'inline-key');
  assert.equal(attempts[1].apiKey, 'masb-env');
  assert.deepEqual(attempts[1].headers, { 'User-Agent': 'browser' });
});

test('prefers a reloadable secret store over the process environment', () => {
  const attempts = buildAttempts({ provider: 'masb', model: 'qwen3.8-27b' }, providers, {
    env, secrets: { MASB_API_KEY: 'ui-managed-key' },
  });
  assert.equal(attempts[0].apiKey, 'ui-managed-key');
});

test('skips disabled fallbacks but refuses a disabled primary provider', () => {
  const attempts = buildAttempts({ provider: 'gemini', model: 'm' }, {
    ...providers, routing: { fallback_chain: ['disabled/off-model', 'masb/qwen3.8-27b'] },
  }, { env: { ...env, OFF_KEY: 'x' } });
  assert.deepEqual(attempts.map((attempt) => attempt.providerId), ['gemini', 'masb']);
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

  const openai = buildChatRequest(buildAttempts({ provider: 'masb', model: 'qwen3.8-27b' }, providers, { env })[0], { prompt: 'hello', policy: 'policy', jsonMode: true });
  assert.equal(openai.url, 'https://ai.masb.web.id/v1/chat/completions');
  assert.equal(openai.headers.Authorization, 'Bearer masb-env');
  assert.equal(openai.headers['User-Agent'], 'browser');
  assert.equal(openai.body.response_format.type, 'json_object');

  const anthropic = buildChatRequest(buildAttempts({ provider: 'anthropic', model: 'claude-sonnet-4-5' }, providers, { env })[0], { prompt: 'hello', policy: 'policy', jsonMode: true });
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropic.headers['x-api-key'], 'anthropic-env');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
  assert.equal(anthropic.body.max_tokens, 8192);
  assert.match(anthropic.body.system, /policy/);
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
