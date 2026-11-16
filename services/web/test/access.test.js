import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteGuard, isAdminTokenConfigured, presentedAdminToken, setAdminCookie, tokenMatches, verifyAdminToken } from '../access.js';

const ADMIN_TOKEN = 'a'.repeat(64);

test('rejects invalid or unconfigured admin credentials', () => {
  assert.equal(tokenMatches('', 'secret'), false);
  assert.equal(tokenMatches('wrong', 'secret'), false);
  assert.equal(tokenMatches('secret-extra', 'secret'), false);
  assert.equal(tokenMatches('secret', ''), false);
});

test('accepts an exact admin token without exposing timing-sensitive comparison', () => {
  assert.equal(tokenMatches('secret', 'secret'), true);
});

test('verifies admin credentials and issues a cookie restricted to API paths', () => {
  assert.equal(isAdminTokenConfigured(ADMIN_TOKEN), true);
  assert.equal(isAdminTokenConfigured('weak'), false);
  assert.equal(verifyAdminToken(ADMIN_TOKEN, ADMIN_TOKEN), true);
  assert.equal(verifyAdminToken('wrong', ADMIN_TOKEN), false);
  const res = { set(name, value) { this[name] = value; } };
  setAdminCookie(res, 'admin'.repeat(13), true);
  assert.match(res['Set-Cookie'], /^gapura_admin=(?:admin){13}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure$/);
});

test('allows only access status and token verification without an admin session', () => {
  const guard = createWriteGuard(ADMIN_TOKEN);
  const next = { count: 0 };
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  guard({ method: 'GET', path: '/access/status', originalUrl: '/api/access/status' }, res, () => next.count++);
  guard({ method: 'POST', path: '/access/verify', originalUrl: '/api/access/verify' }, res, () => next.count++);
  guard({ method: 'POST', path: '/client-log', originalUrl: '/api/client-log', get: () => '' }, res, () => next.count++);
  guard({ method: 'GET', path: '/topics', originalUrl: '/api/topics' }, res, () => next.count++);
  assert.equal(next.count, 2);
  assert.equal(res.statusCode, 401);
});

test('rejects reads and writes without a matching token', () => {
  const guard = createWriteGuard(ADMIN_TOKEN);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  let proceeded = false;
  guard({ method: 'POST', path: '/agents/config', originalUrl: '/api/agents/config', get: () => '' }, res, () => { proceeded = true; });
  assert.equal(proceeded, false);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /Autentikasi admin diperlukan/);
});

test('fails closed when the service has no admin token configured', () => {
  const guard = createWriteGuard('');
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  guard({ method: 'GET', path: '/drafts', originalUrl: '/api/drafts' }, res, () => assert.fail('private API must be blocked'));
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /GAPURA_ADMIN_TOKEN/);
});

test('allows API writes only with the matching admin token', () => {
  const guard = createWriteGuard(ADMIN_TOKEN);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  let proceeded = false;
  guard({ method: 'POST', path: '/agents/config', originalUrl: '/api/agents/config', get: (name) => ({ authorization: `Bearer ${ADMIN_TOKEN}`, host: 'gapura.avenia.my.id', origin: 'https://gapura.avenia.my.id' })[name] || '' }, res, () => { proceeded = true; });
  assert.equal(proceeded, true);
  assert.equal(res.statusCode, 200);
});

test('accepts an HttpOnly session cookie for API requests', () => {
  const guard = createWriteGuard(ADMIN_TOKEN);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  let proceeded = false;
  guard({ method: 'GET', path: '/drafts', originalUrl: '/api/drafts', get: (name) => name === 'cookie' ? `gapura_admin=${ADMIN_TOKEN}` : '' }, res, () => { proceeded = true; });
  assert.equal(proceeded, true);
});

test('reads an HttpOnly token cookie to preserve login across page refresh', () => {
  const req = { get: (name) => name === 'cookie' ? `gapura_admin=${ADMIN_TOKEN}` : '' };
  assert.equal(presentedAdminToken(req), ADMIN_TOKEN);
  assert.equal(verifyAdminToken(presentedAdminToken(req), ADMIN_TOKEN), true);
});

test('rejects cross-origin writes even when the admin session cookie is present', () => {
  const guard = createWriteGuard(ADMIN_TOKEN);
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  guard({ method: 'POST', path: '/agents/config', originalUrl: '/api/agents/config', get: (name) => ({
    cookie: `gapura_admin=${ADMIN_TOKEN}`, origin: 'https://attacker.example', host: 'gapura.avenia.my.id',
  })[name] || '' }, res, () => assert.fail('cross-origin write must not continue'));
  assert.equal(res.statusCode, 403);
});

test('uses the configured Cloudflare public origin when the origin host header is rewritten by the tunnel', () => {
  const guard = createWriteGuard(ADMIN_TOKEN, { publicOrigin: 'https://gapura.avenia.my.id' });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  let proceeded = false;
  guard({ method: 'POST', path: '/agents/config', originalUrl: '/api/agents/config', get: (name) => ({
    authorization: `Bearer ${ADMIN_TOKEN}`, origin: 'https://gapura.avenia.my.id', host: 'localhost:3005',
  })[name] || '' }, res, () => { proceeded = true; });
  assert.equal(proceeded, true);
});
