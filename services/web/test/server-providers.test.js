import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.GAPURA_TEST_BASE || `http://127.0.0.1:${process.env.PORT}`;
const ORIGIN = new URL(BASE).origin;
const headers = { Origin: ORIGIN, 'Content-Type': 'application/json' };

test('provider catalog is available without login and never returns provider keys', async () => {
  const anonymous = await fetch(`${BASE}/api/providers`);
  assert.equal(anonymous.status, 200);
  assert.equal(JSON.stringify(await anonymous.json()).includes('fixture-key'), false);
});

test('provider catalog exposes presets, key status, and routing without leaking keys', async () => {
  const response = await fetch(`${BASE}/api/providers`, { headers });
  assert.equal(response.status, 200);
  const body = await response.json();
  const custom = body.providers.find((provider) => provider.id === 'custom');
  assert.equal(Boolean(custom), true);
  assert.equal(custom.key_configured, false);
  assert.equal(Array.isArray(body.routing.fallback_chain), true);
  assert.equal(JSON.stringify(body).includes('fixture-key'), false);
});

test('saving a provider key makes it usable and never echoes the secret', async () => {
  const saved = await fetch(`${BASE}/api/providers/custom/key`, {
    method: 'POST', headers, body: JSON.stringify({ api_key: 'fixture-provider-key' }),
  });
  assert.equal(saved.status, 200, await saved.text());
  const after = await (await fetch(`${BASE}/api/providers`, { headers })).json();
  assert.equal(after.providers.find((provider) => provider.id === 'custom').key_configured, true);
  assert.equal(JSON.stringify(after).includes('fixture-provider-key'), false);
});

test('a saved provider can be tested through the real request builder', async () => {
  const response = await fetch(`${BASE}/api/providers/test`, {
    method: 'POST', headers, body: JSON.stringify({ provider_id: 'custom', model: 'fixture-model' }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const body = JSON.parse(text);
  assert.equal(body.status, 'passed');
  assert.equal(body.provider, 'custom');
});

test('refreshing one provider stores its live model list', async () => {
  const response = await fetch(`${BASE}/api/providers/refresh`, {
    method: 'POST', headers, body: JSON.stringify({ provider_id: 'custom' }),
  });
  const text = await response.text();
  assert.equal(response.status, 200, text);
  const body = JSON.parse(text);
  const custom = body.providers.find((provider) => provider.id === 'custom');
  assert.deepEqual(custom.models, ['fixture-model', 'fixture-alt']);
});

test('routing accepts known providers and rejects dangling references', async () => {
  const accepted = await fetch(`${BASE}/api/providers/routing`, {
    method: 'POST', headers, body: JSON.stringify({ fallback_chain: ['custom/fixture-model'] }),
  });
  const acceptedText = await accepted.text();
  assert.equal(accepted.status, 200, acceptedText);
  assert.deepEqual(JSON.parse(acceptedText).routing.fallback_chain, ['custom/fixture-model']);

  const rejected = await fetch(`${BASE}/api/providers/routing`, {
    method: 'POST', headers, body: JSON.stringify({ fallback_chain: ['ghost/unknown-model'] }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).details.join(' '), /tidak dikenal/);
});

test('provider upsert rejects unknown fields and unsafe URLs', async () => {
  const unknown = await fetch(`${BASE}/api/providers/custom`, {
    method: 'POST', headers, body: JSON.stringify({ malicious: true }),
  });
  assert.equal(unknown.status, 400);

  const unsafe = await fetch(`${BASE}/api/providers/custom`, {
    method: 'POST', headers, body: JSON.stringify({ base_url: 'http://remote.example/v1' }),
  });
  assert.equal(unsafe.status, 400);
  assert.match((await unsafe.json()).details.join(' '), /HTTPS/);
});
