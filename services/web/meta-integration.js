import crypto from 'node:crypto';
import express from 'express';
import { isIP } from 'node:net';
import { loadMetaConnection, metaConnectionPath, saveMetaConnection } from '../common/meta-connection-store.js';

const CALLBACK_PATH = '/integrations/meta/callback';
const META_OAUTH_COOKIE = 'gapura_meta_oauth';
const STATE_TTL_MS = 10 * 60 * 1000;
const CONNECT_WINDOW_MS = 10 * 60 * 1000;
const CONNECT_LIMIT = 10;
const FAILURE_HINTS = {
  token_exchange: 'Meta menolak pertukaran kode login. Mulai koneksi baru; periksa App Secret dan Redirect URL pada app Meta.',
  business_discovery: 'Token diterima, tetapi business portfolio belum dapat dibaca. Pastikan konfigurasi Unified Login memakai System-user access token dan business portfolio yang benar.',
  instagram_discovery: 'Token diterima, tetapi daftar akun Instagram belum dapat dibaca. Periksa izin instagram_basic dan akun yang dibagikan.',
  account_selection: 'Akun Instagram Gapura yang dikonfigurasi tidak ditemukan pada akun yang dibagikan. Pilih akun Gapura ketika menghubungkan kembali.',
  connection_storage: 'Kredensial belum dapat disimpan oleh server. Operator perlu memeriksa lokasi file koneksi dan izin tulisnya.',
};

function numericCode(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function providerFailure(response, data) {
  const error = new Error('Meta response rejected');
  error.httpStatus = response.status;
  error.metaCode = numericCode(data?.error?.code);
  error.metaSubcode = numericCode(data?.error?.error_subcode);
  error.traceId = /^[A-Za-z0-9_-]{1,128}$/.test(data?.error?.fbtrace_id || '') ? data.error.fbtrace_id : null;
  return error;
}

function html(message, status = 200, connect = false) {
  const safe = String(message).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  return { status, body: `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meta connection</title><meta name="referrer" content="no-referrer"><style>body{font:16px system-ui;max-width:680px;margin:12vh auto;padding:24px;background:#f7f5f0;color:#102b45}h1{font-size:24px}a{color:#1f7e81}</style><h1>${safe}</h1>${connect ? '<p><a href="/integrations/meta/connect">Hubungkan Instagram</a></p>' : ''}<p><a href="/">Kembali ke dashboard Gapura Media</a></p></html>` };
}

function publicOriginFrom(req, configured) {
  if (configured) return new URL(configured).origin;
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return new URL(`${proto}://${host}`).origin;
}

function cookieValue(req) {
  return String(req.get('cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${META_OAUTH_COOKIE}=`))?.slice(META_OAUTH_COOKIE.length + 1) || '';
}

function connectionExpired(connection, now) {
  return connection?.expires_at && Date.parse(connection.expires_at) <= now();
}

export function createMetaIntegration({ config = {}, fetchImpl = globalThis.fetch, now = Date.now, logger = console } = {}) {
  const router = express.Router();
  const states = new Map();
  const attempts = new Map();
  const appId = String(config.appId || '').trim();
  const configId = String(config.configId || '').trim();
  const appSecret = String(config.appSecret || '').trim();
  const graphVersion = String(config.graphVersion || 'v27.0').trim();
  const redirectUri = String(config.redirectUri || `${config.publicOrigin || ''}${CALLBACK_PATH}`).trim();
  const publicOrigin = config.publicOrigin ? new URL(config.publicOrigin).origin : '';
  const expectedInstagramId = String(config.expectedInstagramId || '').trim();
  const connectionFile = metaConnectionPath(config.connectionFile);
  const ready = /^[1-9]\d*$/.test(appId) && /^[1-9]\d*$/.test(configId) && Boolean(appSecret) &&
    /^v\d+\.\d+$/.test(graphVersion) && (() => {
      try { const url = new URL(redirectUri); return url.protocol === 'https:' && url.pathname === CALLBACK_PATH && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
    })();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    next();
  });

  function prune() {
    const timestamp = now();
    for (const [state, entry] of states) if (entry.expiresAt <= timestamp) states.delete(state);
    for (const [ip, entry] of attempts) if (entry.expiresAt <= timestamp) attempts.delete(ip);
  }

  function sameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return true;
    try { return new URL(origin).origin === publicOriginFrom(req, publicOrigin); } catch { return false; }
  }

  function rateLimit(req) {
    prune();
    const remote = String(req.socket?.remoteAddress || '');
    const ingress = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote);
    const cloudflareAddress = String(req.get('cf-connecting-ip') || '');
    // The web listener is loopback-only; cloudflared supplies this header.
    const ip = ingress && isIP(cloudflareAddress) ? cloudflareAddress : String(req.ip || remote || 'unknown');
    const entry = attempts.get(ip) || { count: 0, expiresAt: now() + CONNECT_WINDOW_MS };
    entry.count += 1;
    attempts.set(ip, entry);
    return entry.count <= CONNECT_LIMIT;
  }

  router.get('/', (_req, res) => {
    const message = ready ? 'Hubungkan Instagram Gapura melalui Meta Unified Login.'
      : 'Koneksi Meta belum siap. Operator perlu memasang META_APP_ID, META_UNIFIED_CONFIG_ID, META_APP_SECRET, dan redirect HTTPS yang benar.';
    return res.type('html').send(html(message, 200, ready).body);
  });

  router.get('/connect', (req, res) => {
    if (!sameOrigin(req) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).type('text/plain').send('Origin tidak diizinkan.');
    if (!ready) return res.status(503).type('text/plain').send('Meta Unified Login belum dikonfigurasi: META_APP_ID, META_UNIFIED_CONFIG_ID, META_APP_SECRET, dan redirect HTTPS diperlukan.');
    if (!rateLimit(req)) return res.status(429).type('text/plain').send('Terlalu banyak permintaan koneksi Meta. Coba lagi nanti.');
    const state = crypto.randomBytes(32).toString('base64url');
    const nonce = crypto.randomBytes(32).toString('base64url');
    states.set(state, { nonce, expiresAt: now() + STATE_TTL_MS });
    const location = new URL('https://www.facebook.com/dialog/oauth');
    location.searchParams.set('client_id', appId);
    location.searchParams.set('config_id', configId);
    location.searchParams.set('display', 'popup');
    location.searchParams.set('override_default_response_type', 'true');
    location.searchParams.set('redirect_uri', redirectUri);
    location.searchParams.set('response_type', 'code');
    location.searchParams.set('state', state);
    location.searchParams.set('prompt', 'login');
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Set-Cookie', `${META_OAUTH_COOKIE}=${encodeURIComponent(nonce)}; Path=/integrations/meta; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return res.redirect(302, location.toString());
  });

  router.get('/callback', async (req, res) => {
    prune();
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const entry = states.get(state);
    let cookie = '';
    try { cookie = decodeURIComponent(cookieValue(req)); } catch {}
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !entry || !/^[A-Za-z0-9_-]{43}$/.test(cookie) ||
        !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(entry.nonce)) || entry.expiresAt <= now()) {
      return res.status(400).type('html').send(html('Sesi koneksi Meta tidak valid atau sudah kedaluwarsa.', 400).body);
    }
    states.delete(state);
    res.set('Set-Cookie', `${META_OAUTH_COOKIE}=; Path=/integrations/meta; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    if (req.query.error) return res.status(400).type('html').send(html('Koneksi Meta dibatalkan.', 400).body);
    if (!code || !appId || !configId || !appSecret) return res.status(400).type('html').send(html('Callback Meta tidak lengkap.', 400).body);
    let stage = 'token_exchange';
    try {
      const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
      tokenUrl.searchParams.set('client_id', appId);
      tokenUrl.searchParams.set('client_secret', appSecret);
      tokenUrl.searchParams.set('code', code);
      tokenUrl.searchParams.set('redirect_uri', redirectUri);
      const tokenResponse = await fetchImpl(tokenUrl, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || tokenData.error || typeof tokenData.access_token !== 'string' || !tokenData.access_token) throw providerFailure(tokenResponse, tokenData);
      if (tokenData.expires_in !== undefined && (!Number.isFinite(Number(tokenData.expires_in)) || Number(tokenData.expires_in) <= 0)) throw providerFailure(tokenResponse, tokenData);
      const accessToken = String(tokenData.access_token);
      const auth = { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) };
      stage = 'business_discovery';
      const clientResponse = await fetchImpl(`https://graph.facebook.com/${graphVersion}/me?fields=client_business_id`, auth);
      const clientData = await clientResponse.json().catch(() => ({}));
      if (!clientResponse.ok || clientData.error || !/^\d+$/.test(String(clientData.client_business_id || ''))) throw providerFailure(clientResponse, clientData);
      stage = 'instagram_discovery';
      const accountsResponse = await fetchImpl(`https://graph.facebook.com/${graphVersion}/me/assigned_instagram_accounts?fields=id,username`, auth);
      const accountsData = await accountsResponse.json().catch(() => ({}));
      if (!accountsResponse.ok || accountsData.error || !Array.isArray(accountsData.data)) throw providerFailure(accountsResponse, accountsData);
      const accounts = Array.isArray(accountsData.data) ? accountsData.data : [];
      stage = 'account_selection';
      const account = accounts.find((item) => String(item.id) === expectedInstagramId) || (expectedInstagramId || accounts.length !== 1 ? null : accounts[0]);
      if (!account || !/^\d+$/.test(String(account.id)) || typeof account.username !== 'string') throw new Error('Instagram account not found');
      const expiresAt = Number.isFinite(Number(tokenData.expires_in)) ? new Date(now() + Number(tokenData.expires_in) * 1000).toISOString() : null;
      stage = 'connection_storage';
      saveMetaConnection({ access_token: accessToken, app_id: appId, config_id: configId, client_business_id: String(clientData.client_business_id), instagram_account_id: String(account.id), username: account.username, graph_version: graphVersion, connected_at: new Date(now()).toISOString(), expires_at: expiresAt }, connectionFile);
      res.set('Cache-Control', 'no-store');
      res.set('Referrer-Policy', 'no-referrer');
      return res.status(200).type('html').send(html(`Koneksi Meta berhasil untuk @${account.username}.`, 200).body);
    } catch (error) {
      const diagnostic = { stage, http_status: numericCode(error.httpStatus), meta_code: numericCode(error.metaCode), meta_subcode: numericCode(error.metaSubcode), trace_id: error.traceId || null };
      logger.warn?.(`[Meta OAuth] ${JSON.stringify(diagnostic)}`);
      // Controlled callback failures should render application guidance. A 502
      // is replaced by Cloudflare's error page and hides the useful message.
      const code = diagnostic.meta_code === null ? '' : ` Meta code ${diagnostic.meta_code}${diagnostic.meta_subcode === null ? '' : `/${diagnostic.meta_subcode}`}.`;
      return res.status(400).type('html').send(html(`${FAILURE_HINTS[stage]} Tahap: ${stage}.${code}`, 400).body);
    }
  });

  router.get('/status', (_req, res) => {
    const connection = loadMetaConnection(connectionFile);
    if (!connection || connection.app_id !== appId || connection.config_id !== configId ||
        (expectedInstagramId && connection.instagram_account_id !== expectedInstagramId) || connectionExpired(connection, now)) return res.json({ connected: false, ready });
    return res.json({ connected: true, instagram_account_id: connection.instagram_account_id, username: connection.username, client_business_id: connection.client_business_id, connected_at: connection.connected_at, expires_at: connection.expires_at, config_id: connection.config_id });
  });

  return router;
}
