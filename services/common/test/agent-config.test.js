import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAgent, validateAgentConfig } from '../agent-config.js';
import { callAgentLLM } from '../llm.js';

const valid = () => ({
  analis: { provider: 'gemini', model: 'flash', endpoint: 'https://generativelanguage.googleapis.com', min_score_threshold: 76, weights: { relevance: 30, credibility: 25, momentum: 20, engagement: 15, compliance: 10 }, fast_fail_rules: 'hoaks\\s+detected' },
  copywriter: { provider: 'gemini', model: 'flash', slide_count: 5 },
  designer: { provider: 'gemini', model: 'flash' }, seo: { provider: 'gemini', model: 'flash' },
  verifikator: { provider: 'gemini', model: 'flash' }, studio: { provider: 'gemini', model: 'flash' },
});

const validImageGeneration = () => ({
  enabled: true,
  provider: 'gemini',
  model: 'gemini-3.1-flash-lite-image',
  rights_reference: 'https://ai.google.dev/gemini-api/terms',
  timeout_ms: 90000,
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

test('keeps legacy Designer settings compatible and accepts complete image settings including timeout boundaries', () => {
  assert.deepEqual(validateAgentConfig(valid()), []);
  for (const enabled of [true, false]) {
    for (const timeout_ms of [1000, 90000, 120000]) {
      const config = valid();
      config.designer.image_generation = { ...validImageGeneration(), enabled, timeout_ms };
      assert.deepEqual(validateAgent('designer', config.designer), []);
      assert.deepEqual(validateAgentConfig(config), []);
    }
  }
});

test('tracks enabled Gemini image defaults without an image-specific secret', () => {
  const config = JSON.parse(readFileSync(new URL('../../../config/agents.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.designer.image_generation, validImageGeneration());
  assert.deepEqual(validateAgentConfig(config), []);
});

test('rejects malformed image_generation objects rather than silently ignoring them', () => {
  for (const image_generation of [undefined, null, [], true, 42, 'gemini']) {
    const designer = { ...valid().designer, image_generation };
    assert.deepEqual(validateAgent('designer', designer), ['designer.image_generation: konfigurasi wajib berupa object.']);
  }
});

test('requires every image setting even while image generation is disabled', () => {
  const required = {
    enabled: 'enabled wajib berupa boolean.',
    provider: 'provider harus gemini.',
    model: 'model wajib berupa string yang tidak kosong.',
    rights_reference: 'rights_reference harus https://ai.google.dev/gemini-api/terms.',
    timeout_ms: 'timeout_ms harus bilangan bulat 1000-120000.',
  };
  for (const [field, message] of Object.entries(required)) {
    const config = valid();
    config.designer.image_generation = { ...validImageGeneration(), enabled: false };
    delete config.designer.image_generation[field];
    assert.deepEqual(validateAgentConfig(config), [`designer.image_generation: ${message}`], field);
  }
});

test('rejects unknown image settings and nested API keys without echoing secret values', () => {
  for (const field of ['api_key', 'endpoint', 'unexpected']) {
    const config = valid();
    config.designer.image_generation = { ...validImageGeneration(), [field]: 'do-not-expose-this-secret' };
    const errors = validateAgentConfig(config);
    assert.deepEqual(errors, [`designer.image_generation: field tidak didukung (${field}).`]);
    assert.ok(!errors.join(' ').includes('do-not-expose-this-secret'));
  }
});

test('rejects unsupported image providers and invalid field types or values', () => {
  const invalid = {
    enabled: ['true', 1, null],
    provider: ['openai', 'Gemini', '', null, {}],
    model: ['', '  ', null, 123, {}, []],
    rights_reference: ['', null, {}, 'not-a-url', 'http://ai.google.dev/gemini-api/terms', 'https://example.com/terms', 'https://ai.google.dev/gemini-api/terms?other=1'],
    timeout_ms: [0, 999, 120001, 90000.5, '90000', true, null, {}, NaN, Infinity],
  };
  for (const [field, values] of Object.entries(invalid)) {
    for (const value of values) {
      const config = valid();
      config.designer.image_generation = { ...validImageGeneration(), [field]: value };
      const errors = validateAgentConfig(config);
      assert.equal(errors.length, 1, `${field}: ${String(value)}`);
      assert.match(errors[0], new RegExp(`^designer\\.image_generation: ${field} `));
    }
  }
});
