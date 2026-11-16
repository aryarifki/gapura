import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAgent, validateAgentConfig } from '../agent-config.js';
import { callAgentLLM } from '../llm.js';

const valid = () => ({
  analis: { provider: 'gemini', model: 'flash', endpoint: 'https://generativelanguage.googleapis.com', min_score_threshold: 76, weights: { relevance: 30, credibility: 25, momentum: 20, engagement: 15, compliance: 10 }, fast_fail_rules: 'hoaks\\s+detected' },
  copywriter: { provider: 'gemini', model: 'flash', slide_count: 5 },
  designer: { provider: 'gemini', model: 'flash' }, seo: { provider: 'gemini', model: 'flash' },
  verifikator: { provider: 'gemini', model: 'flash' }, studio: { provider: 'gemini', model: 'flash' },
});

test('accepts valid saved settings for all configured agents', () => {
  assert.deepEqual(validateAgentConfig(valid()), []);
});

test('rejects incomplete providers, unsafe endpoints, and unsupported models', () => {
  const config = valid();
  config.designer.provider = 'unknown';
  config.seo.model = ' ';
  config.studio.endpoint = 'http://remote.example/api';
  assert.deepEqual(validateAgentConfig(config), [
    'designer: provider tidak didukung.',
    'seo: model wajib diisi.',
    'studio: endpoint remote harus HTTPS.',
  ]);
});

test('rejects invalid thresholds, unbalanced weights, malformed fast-fail regex, and slide limits', () => {
  const config = valid();
  config.analis.min_score_threshold = 101;
  config.analis.weights.relevance = 20;
  config.analis.fast_fail_rules = '[';
  config.copywriter.slide_count = 9;
  assert.deepEqual(validateAgentConfig(config), [
    'analis: ambang skor harus bilangan bulat 0-100.',
    'analis: bobot harus bilangan bulat non-negatif dan totalnya 100.',
    'analis: pola fast-fail tidak valid ([).',
    'copywriter: jumlah slide default harus 1-8.',
  ]);
});

test('executes an agent-settings test against temporary config and an injected provider client', async () => {
  const config = { analis: { provider: 'gemini', endpoint: 'https://generativelanguage.googleapis.com', model: 'test-model', api_key: 'temporary-secret' } };
  let request;
  const response = await callAgentLLM('analis', 'Return JSON', '', true, {
    config,
    timeoutMs: 3210,
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
    },
  });
  assert.equal(response, '{"ok":true}');
  assert.match(request.url, /test-model:generateContent/);
  assert.equal(request.options.headers['x-goog-api-key'], 'temporary-secret');
  assert.equal(request.options.signal.aborted, false);
});

test('validates one agent without requiring unrelated agent configurations', () => {
  assert.deepEqual(validateAgent('designer', { provider: 'gemini', model: 'flash', endpoint: 'https://generativelanguage.googleapis.com' }), []);
  assert.deepEqual(validateAgent('studio', { provider: 'custom', model: 'm', endpoint: 'https://provider.example' }), []);
});
