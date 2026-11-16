import test from 'node:test';
import assert from 'node:assert/strict';

const PORT = Number(process.env.PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = process.env.GAPURA_ADMIN_TOKEN;

test('server integration: public access bootstrap and protected settings API', async () => {
  const status = await fetch(`${BASE}/api/access/status`);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).admin_token_configured, true);

  const anonymous = await fetch(`${BASE}/api/agents/config`);
  assert.equal(anonymous.status, 401);

  const authorized = await fetch(`${BASE}/api/agents/config`, {
    headers: { Cookie: `gapura_admin=${TOKEN}` },
  });
  assert.equal(authorized.status, 200);
  const config = await authorized.json();
  assert.equal(Boolean(config.analis), true);
  assert.equal(config.analis.api_key, '');
  assert.equal(Boolean(config.skills.studio), true);
});

test('server integration: configuration writes reject cross-origin browser requests', async () => {
  const response = await fetch(`${BASE}/api/agents/config`, {
    method: 'POST',
    headers: {
      Cookie: `gapura_admin=${TOKEN}`,
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
    headers: { Cookie: `gapura_admin=${TOKEN}`, Origin: `http://127.0.0.1:${PORT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: 'invalid', prompt: 'hello test' }),
  });
  assert.equal(response.status, 400);
});

test('server integration: UI html contains local icon assets and does not leave the app inert after access', async () => {
  const response = await fetch(BASE);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /admin-access-gate/);
  assert.match(html, /icon-map\.js/);
  assert.match(html, /app-container" inert/);
});

test('server integration: malformed IDs and query shapes return actionable validation errors', async () => {
  for (const url of ['/api/drafts/not-a-number', '/api/topics/2bad/verification', '/api/agents/invalid/skills', '/api/topics?q[]=x']) {
    const response = await fetch(`${BASE}${url}`, { headers: { Cookie: `gapura_admin=${TOKEN}` } });
    assert.equal(response.status, 400, `${url}: ${await response.text()}`);
  }
});
