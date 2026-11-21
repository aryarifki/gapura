import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildModelsRequest, loadModelCache, refreshModels, providerInventory } from '../model-catalog.js';

const providers = {
  providers: {
    gemini: { label: 'Gemini', kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true },
    groq: { label: 'Groq', kind: 'openai', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: true },
    anthropic: { label: 'Anthropic', kind: 'anthropic', base_url: 'https://api.anthropic.com', api_key_env: 'ANTHROPIC_API_KEY', enabled: true },
    off: { label: 'Off', kind: 'openai', base_url: 'https://off.example/v1', api_key_env: 'OFF_KEY', enabled: false },
    nokey: { label: 'No key', kind: 'openai', base_url: 'https://nokey.example/v1', api_key_env: 'NOKEY_API_KEY', enabled: true },
  },
  routing: { fallback_chain: [] },
};

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gapura-catalog-')), 'models.cache.json');

test('builds model-list requests with the right URL and auth transport', () => {
  const gemini = buildModelsRequest({ providerId: 'gemini', ...providers.providers.gemini, apiKey: 'g-key' });
  assert.equal(gemini.url, 'https://generativelanguage.googleapis.com/v1beta/models');
  assert.equal(gemini.headers['x-goog-api-key'], 'g-key');

  const groq = buildModelsRequest({ providerId: 'groq', ...providers.providers.groq, apiKey: 'g-key' });
  assert.equal(groq.url, 'https://api.groq.com/openai/v1/models');
  assert.equal(groq.headers.Authorization, 'Bearer g-key');
  assert.equal(groq.headers['User-Agent'], undefined);

  const anthropic = buildModelsRequest({ providerId: 'anthropic', ...providers.providers.anthropic, apiKey: 'a-key' });
  assert.equal(anthropic.url, 'https://api.anthropic.com/v1/models');
  assert.equal(anthropic.headers['x-api-key'], 'a-key');
  assert.equal(anthropic.headers['anthropic-version'], '2023-06-01');
});

test('refreshes one provider, caches its models, and preserves the other providers', async () => {
  const cachePath = tempFile();
  fs.writeFileSync(cachePath, JSON.stringify({ providers: { groq: { models: ['kept'], fetched_at: '2026-01-01T00:00:00.000Z', error: null } } }));
  const calls = [];
  const result = await refreshModels({
    providerId: 'gemini', config: providers, cachePath,
    env: { GEMINI_API_KEY: 'g-key' },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-1', supportedGenerationMethods: ['embedContent'] },
      ] });
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(result.providers.gemini.models, ['gemini-2.5-flash']);
  assert.deepEqual(result.providers.groq.models, ['kept']);
  const persisted = loadModelCache(cachePath);
  assert.deepEqual(persisted.providers.gemini.models, ['gemini-2.5-flash']);
});

test('records a redacted error for one provider without failing the whole refresh', async () => {
  const cachePath = tempFile();
  const result = await refreshModels({
    config: providers, cachePath,
    env: { GEMINI_API_KEY: 'g-key', GROQ_API_KEY: 'super-secret-groq' },
    fetchImpl: async (url) => url.includes('groq')
      ? new Response('invalid key super-secret-groq', { status: 401 })
      : Response.json({ models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }] }),
  });
  assert.deepEqual(result.providers.gemini.models, ['gemini-2.5-pro']);
  assert.match(result.providers.groq.error, /401/);
  assert.equal(result.providers.groq.error.includes('super-secret-groq'), false);
});

test('skips providers that are disabled or have no key and reports why', async () => {
  const cachePath = tempFile();
  const calls = [];
  const result = await refreshModels({
    config: providers, cachePath, env: { OFF_KEY: 'x' },
    fetchImpl: async (url) => { calls.push(url); return Response.json({ data: [] }); },
  });
  assert.deepEqual(calls, []);
  assert.match(result.providers.off.error, /dinonaktifkan/);
  assert.match(result.providers.nokey.error, /API Key/);
});

test('inventory reports key status, cached model count, and never leaks keys', () => {
  const cache = { providers: { gemini: { models: ['a', 'b'], fetched_at: '2026-01-01T00:00:00.000Z', error: null } } };
  const items = providerInventory(providers, { env: { GEMINI_API_KEY: 'secret-key', GROQ_API_KEY: 'm' }, cache });
  const gemini = items.find((item) => item.id === 'gemini');
  assert.equal(gemini.key_configured, true);
  assert.equal(gemini.model_count, 2);
  assert.equal(JSON.stringify(items).includes('secret-key'), false);
  assert.equal(items.find((item) => item.id === 'off').enabled, false);
  assert.equal(items.find((item) => item.id === 'nokey').key_configured, false);
});
