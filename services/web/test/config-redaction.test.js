import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeAgentConfig, redactAgentConfig } from '../access.js';

test('redacts configured agent secrets and reports only whether a key is set', () => {
  const source = { scout: { rules: 'keep' }, analis: { api_key: 'secret-value', model: 'model-x' } };
  const safe = redactAgentConfig(source);
  assert.deepEqual(safe, {
    scout: { rules: 'keep' },
    analis: { api_key: '', api_key_configured: true, model: 'model-x' },
  });
  assert.equal(JSON.stringify(safe).includes('secret-value'), false);
});

test('does not mark empty keys as configured', () => {
  assert.deepEqual(redactAgentConfig({ studio: { api_key: '' } }), {
    studio: { api_key: '', api_key_configured: false },
  });
});

test('preserves stored provider keys when a redacted settings form is saved', () => {
  const merged = mergeAgentConfig(
    { studio: { model: 'old-model' }, analis: { api_key: 'stored-secret', model: 'old-model' } },
    { skills: {}, analis: { api_key: '', model: 'new-model' } },
  );
  assert.deepEqual(merged, {
    studio: { model: 'old-model' },
    analis: { api_key: 'stored-secret', model: 'new-model' },
    skills: {},
  });
});

test('allows replacing a provider key only when a non-empty value is provided', () => {
  assert.deepEqual(mergeAgentConfig({ analis: { api_key: 'old' } }, { analis: { api_key: 'new' } }), {
    analis: { api_key: 'new' },
  });
});
