import test from 'node:test';
import assert from 'node:assert/strict';

const PORT = Number(process.env.PORT);
const BASE = `http://127.0.0.1:${PORT}`;
test('server integration: dashboard settings are available immediately without login', async () => {
  const anonymous = await fetch(`${BASE}/api/agents/config`);
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.has('set-cookie'), false);
  const config = await anonymous.json();
  assert.equal(Boolean(config.analis), true);
  assert.equal(config.analis.api_key, '');
  assert.equal(Boolean(config.skills.studio), true);
});

test('server integration: configuration writes reject cross-origin browser requests', async () => {
  const response = await fetch(`${BASE}/api/agents/config`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      Host: `127.0.0.1:${PORT}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(response.status, 403);
});

test('server integration: Lucide sprite is served locally', async () => {
  const response = await fetch(`${BASE}/lucide-sprite.svg`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await response.text(), /id="house"/);
});

test('server integration: invalid agent-test requests fail before contacting any provider', async () => {
  const response = await fetch(`${BASE}/api/agents/config/test`, {
    method: 'POST',
    headers: { Origin: `http://127.0.0.1:${PORT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: 'invalid', prompt: 'hello test' }),
  });
  assert.equal(response.status, 400);
});

test('server integration: UI opens without an access gate or inert container', async () => {
  const response = await fetch(BASE);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /admin-access-gate|admin-access-token/);
  assert.match(html, /icon-map\.js/);
  assert.doesNotMatch(html, /app-container" inert/);
});

test('server integration: malformed IDs and query shapes return actionable validation errors', async () => {
  for (const url of ['/api/drafts/not-a-number', '/api/topics/2bad/verification', '/api/agents/invalid/skills', '/api/topics?q[]=x']) {
    const response = await fetch(`${BASE}${url}`);
    assert.equal(response.status, 400, `${url}: ${await response.text()}`);
  }
});

test('server integration: retired admin access endpoints do not accept or issue sessions', async () => {
  const status = await fetch(`${BASE}/api/access/status`);
  const verify = await fetch(`${BASE}/api/access/verify`, { method: 'POST' });
  assert.equal(status.status, 404);
  assert.equal(verify.status, 404);
  assert.equal(verify.headers.has('set-cookie'), false);
});

test('server integration: publisher media URLs retain signature checks without a dashboard login', async () => {
  for (const extension of ['png', 'jpg']) {
    const response = await fetch(`${BASE}/media/drafts/1/slide_1.${extension}`);
    assert.equal(response.status, 403);
  }
});

test('server integration: Meta connection callback exists separately from dashboard access', async () => {
  const landing = await fetch(`${BASE}/integrations/meta/`);
  assert.equal(landing.status, 200);
  assert.match(await landing.text(), /META_APP_SECRET/);
  const callback = await fetch(`${BASE}/integrations/meta/callback?state=%3CSTATE%3E&code=private-code`);
  assert.equal(callback.status, 400);
  assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await callback.text()).includes('private-code'), false);
  const start = await fetch(`${BASE}/integrations/meta/connect`, { redirect: 'manual' });
  assert.equal(start.status, 503);
  assert.equal(start.headers.has('location'), false);
});
