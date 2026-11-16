import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { createMetaIntegration } from '../meta-integration.js';
import { loadMetaConnection } from '../../common/meta-connection-store.js';

const config = { appId: '1123019133826199', configId: '1848852586267233', appSecret: 'private-app-secret', publicOrigin: 'https://gapura.example', expectedInstagramId: '1784', connectionFile: '', graphVersion: 'v27.0' };

async function fixture(t, { override = {}, responses = [] } = {}) {
  const temp = await fs.mkdtemp('/tmp/opencode/gapura-meta-oauth-');
  const calls = [];
  let now = 1000;
  const app = express();
  const connectionFile = path.join(temp, 'meta.json');
  app.use('/integrations/meta', createMetaIntegration({
    config: { ...config, connectionFile, ...override }, now: () => now,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Unexpected provider call');
      return response instanceof Response ? response : Response.json(response);
    },
  }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fs.rm(temp, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}/integrations/meta`;
  const start = async () => {
    const response = await fetch(`${base}/connect`, { redirect: 'manual' });
    const location = new URL(response.headers.get('location'));
    return { response, state: location.searchParams.get('state'), cookie: response.headers.get('set-cookie').split(';')[0], location };
  };
  return { base, calls, start, connectionFile, advance() { now += 601000; } };
}

test('Meta start binds random single-use state to a secure browser cookie and fixed callback', async (t) => {
  const f = await fixture(t);
  const { response, location, state, cookie } = await f.start();
  assert.equal(response.status, 302);
  assert.equal(location.origin, 'https://www.facebook.com');
  assert.equal(location.pathname, '/dialog/oauth');
  assert.equal(location.searchParams.get('client_id'), config.appId);
  assert.equal(location.searchParams.get('config_id'), config.configId);
  assert.equal(location.searchParams.get('redirect_uri'), 'https://gapura.example/integrations/meta/callback');
  assert.match(state, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!cookie.includes(state), 'server state is independent of browser nonce');
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const other = await f.start();
  assert.notEqual(other.state, state);
});

test('Meta callback rejects placeholder, absent/wrong cookie, expired and replayed states before exchange', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.base}/callback?state=%3CSTATE%3E&code=secret-code`)).status, 400);
  const { state, cookie } = await f.start();
  assert.equal((await fetch(`${f.base}/callback?state=${state}&code=secret-code`)).status, 400);
  assert.equal((await fetch(`${f.base}/callback?state=${state}&code=secret-code`, { headers: { Cookie: 'gapura_meta_oauth=wrong' } })).status, 400);
  f.advance();
  assert.equal((await fetch(`${f.base}/callback?state=${state}&code=secret-code`, { headers: { Cookie: cookie } })).status, 400);
  assert.equal(f.calls.length, 0);
});

test('malformed query/cookie input never crashes and a wrong browser cannot consume valid state', async (t) => {
  const f = await fixture(t, { responses: [{ access_token: 'private-suat' }, { client_business_id: '99' }, { data: [{ id: '1784', username: 'gapuramedia' }] }] });
  const { state, cookie } = await f.start();
  assert.equal((await fetch(`${f.base}/callback?state=${state}&code=code`, { headers: { Cookie: 'gapura_meta_oauth=%ZZ' } })).status, 400);
  assert.equal((await fetch(`${f.base}/callback?state=${state}&state=duplicate&code=code`, { headers: { Cookie: cookie } })).status, 400);
  const response = await fetch(`${f.base}/callback?state=${state}&code=code`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.equal(f.calls.length, 3);
});

test('valid Unified callback stores SUAT and asset IDs without returning credentials or code', async (t) => {
  const f = await fixture(t, { responses: [{ access_token: 'private-suat', expires_in: 3600 }, { client_business_id: '99', id: 'system-user' }, { data: [{ id: '1784', username: 'gapuramedia' }] }] });
  const { state, cookie } = await f.start();
  const response = await fetch(`${f.base}/callback?state=${state}&code=private-code`, { headers: { Cookie: cookie } });
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /berhasil/i);
  assert.equal(/private-suat|private-code|private-app-secret/.test(text), false);
  const stored = loadMetaConnection(f.connectionFile);
  assert.equal(stored.access_token, 'private-suat');
  assert.equal(stored.client_business_id, '99');
  assert.equal(stored.instagram_account_id, '1784');
  assert.equal(stored.app_id, config.appId);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[1].url.includes('/me?fields=client_business_id'));
  assert.ok(f.calls[2].url.includes('/me/assigned_instagram_accounts'));
  assert.equal(f.calls[1].init.headers.Authorization, 'Bearer private-suat');
  const replay = await fetch(`${f.base}/callback?state=${state}&code=private-code`, { headers: { Cookie: cookie } });
  assert.equal(replay.status, 400);
  assert.equal(f.calls.length, 3);
  const status = await fetch(`${f.base}/status`).then((r) => r.json());
  assert.equal(status.connected, true);
  assert.equal(status.instagram_account_id, '1784');
  assert.equal(JSON.stringify(status).includes('private-suat'), false);
});

test('missing app secret gives setup guidance without calling Meta or issuing a login state', async (t) => {
  const f = await fixture(t, { override: { appSecret: '' } });
  const response = await fetch(`${f.base}/connect`, { redirect: 'manual' });
  assert.equal(response.status, 503);
  assert.match(await response.text(), /META_APP_SECRET/);
  assert.equal(response.headers.has('location'), false);
  assert.equal(f.calls.length, 0);
});

test('Meta connection page is a usable same-origin entry point with honest readiness status', async (t) => {
  const f = await fixture(t, { override: { appSecret: '' } });
  const response = await fetch(`${f.base}/`);
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /META_APP_SECRET/);
  assert.doesNotMatch(text, /href="\/integrations\/meta\/connect"/);
  assert.equal(f.calls.length, 0);
  const ready = await fixture(t);
  const page = await fetch(`${ready.base}/`).then((r) => r.text());
  assert.match(page, /href="\/integrations\/meta\/connect"/);
  assert.match(page, /Hubungkan Instagram/);
  assert.equal(page.includes('private-app-secret'), false);
});

test('OAuth token lifetime and response errors never overwrite a working connection', async (t) => {
  for (const tokenResponse of [{ access_token: 'private-suat', expires_in: -1 }, { access_token: 'private-suat', error: { message: 'provider-error' } }]) {
    const f = await fixture(t, { responses: [tokenResponse, { client_business_id: '99' }, { data: [{ id: '1784', username: 'gapuramedia' }] }] });
    const { state, cookie } = await f.start();
    const response = await fetch(`${f.base}/callback?state=${state}&code=code`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 502);
    assert.equal(loadMetaConnection(f.connectionFile), null);
  }
});

test('OAuth callback always has no-referrer/no-store headers and ignores cross-site callback Origin', async (t) => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}/callback?state=%3CSTATE%3E&code=secret`, { headers: { Origin: 'https://www.facebook.com' } });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
});

test('provider failures and a different Instagram account leave connection unchanged without leaking secrets', async (t) => {
  for (const responses of [
    [Response.json({ error: { message: 'private-app-secret private-code' } }, { status: 400 })],
    [{ access_token: 'private-suat' }, { client_business_id: '99' }, { data: [{ id: '999', username: '<script>alert(1)</script>' }] }],
  ]) await t.test('failed connection', async (sub) => {
    const f = await fixture(sub, { responses });
    const { state, cookie } = await f.start();
    const response = await fetch(`${f.base}/callback?state=${state}&code=private-code`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 502);
    assert.equal(/private-suat|private-code|private-app-secret|<script>/.test(await response.text()), false);
    assert.equal(loadMetaConnection(f.connectionFile), null);
  });
});

test('Meta connect rate limit is bounded and cross-site initiation is rejected', async (t) => {
  const f = await fixture(t);
  const cross = await fetch(`${f.base}/connect`, { redirect: 'manual', headers: { Origin: 'https://other.example', 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(cross.status, 403);
  for (let i = 0; i < 10; i++) assert.equal((await fetch(`${f.base}/connect`, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(`${f.base}/connect`, { redirect: 'manual' })).status, 429);
});

test('loopback Cloudflare ingress gives separate rate limits to validated client addresses', async (t) => {
  const f = await fixture(t);
  for (const address of ['198.51.100.10', '198.51.100.20']) {
    for (let i = 0; i < 10; i++) {
      const response = await fetch(`${f.base}/connect`, { redirect: 'manual', headers: { 'CF-Connecting-IP': address } });
      assert.equal(response.status, 302, address);
    }
    const limited = await fetch(`${f.base}/connect`, { redirect: 'manual', headers: { 'CF-Connecting-IP': address } });
    assert.equal(limited.status, 429, address);
  }
});
