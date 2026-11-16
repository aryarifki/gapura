import { timingSafeEqual } from 'node:crypto';

const PUBLIC_READ_PATHS = new Set(['/api/access/status']);
const PUBLIC_WRITE_PATHS = new Set(['/api/access/verify']);
const MIN_TOKEN_LENGTH = 32;

export function tokenMatches(provided, configured) {
  if (typeof provided !== 'string' || typeof configured !== 'string' || !configured) return false;
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  return providedBuffer.length === configuredBuffer.length && timingSafeEqual(providedBuffer, configuredBuffer);
}

export function isAdminTokenConfigured(token) {
  return typeof token === 'string' && token.length >= MIN_TOKEN_LENGTH;
}

export function createWriteGuard(adminToken, { publicOrigin = '' } = {}) {
  return (req, res, next) => {
    const requestPath = String(req.originalUrl || req.path || '').split('?')[0];
    if (PUBLIC_READ_PATHS.has(requestPath) || (String(req.method).toUpperCase() === 'POST' && PUBLIC_WRITE_PATHS.has(requestPath))) {
      return next();
    }

    if (!isAdminTokenConfigured(adminToken)) {
      return res.status(503).json({ error: 'Akses admin belum dikonfigurasi. Set GAPURA_ADMIN_TOKEN di environment service.' });
    }

    const origin = req.get?.('origin');
    if (origin) {
      let parsedOrigin;
      try { parsedOrigin = new URL(origin); } catch { return res.status(403).json({ error: 'Origin request tidak valid.' }); }
      const forwardedHost = req.get?.('x-forwarded-host');
      const host = String(forwardedHost || req.get?.('host') || '').split(',')[0].trim().toLowerCase();
      const expectedOrigin = publicOrigin ? new URL(publicOrigin).origin : '';
      if ((expectedOrigin ? parsedOrigin.origin !== expectedOrigin : parsedOrigin.host.toLowerCase() !== host)
        || !['https:', 'http:'].includes(parsedOrigin.protocol)) {
        return res.status(403).json({ error: 'Cross-origin request ditolak.' });
      }
    }

    const bearer = /^Bearer\s+(.+)$/i.exec(req.get?.('authorization') || '')?.[1] || '';
    const headerToken = req.get?.('x-gapura-admin-token') || '';
    const cookieToken = String(req.get?.('cookie') || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('gapura_admin='))
      ?.slice('gapura_admin='.length) || '';
    let decodedCookieToken = cookieToken;
    try { decodedCookieToken = decodeURIComponent(cookieToken); } catch {}
    if (!tokenMatches(bearer || headerToken || decodedCookieToken, adminToken)) {
      return res.status(401).json({ error: 'Autentikasi admin diperlukan.' });
    }
    return next();
  };
}

export function verifyAdminToken(provided, configured) {
  return isAdminTokenConfigured(configured) && tokenMatches(provided, configured);
}

export function presentedAdminToken(req) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get?.('authorization') || '')?.[1] || '';
  const header = req.get?.('x-gapura-admin-token') || '';
  const cookie = String(req.get?.('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('gapura_admin='))?.slice('gapura_admin='.length) || '';
  try { return bearer || header || decodeURIComponent(cookie); } catch { return bearer || header || ''; }
}

export function setAdminCookie(res, token, secure = true) {
  const flags = ['gapura_admin=' + encodeURIComponent(token), 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=28800'];
  if (secure) flags.push('Secure');
  res.set('Set-Cookie', flags.join('; '));
}

export function redactAgentConfig(config) {
  return Object.fromEntries(Object.entries(config || {}).map(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'api_key')) return [key, value];
    return [key, { ...value, api_key: '', api_key_configured: Boolean(value.api_key) }];
  }));
}

export function mergeAgentConfig(existing, incoming) {
  const result = { ...existing, ...incoming };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    result[key] = { ...(existing?.[key] || {}), ...value };
    if (!value.api_key && existing?.[key]?.api_key) result[key].api_key = existing[key].api_key;
  }
  return result;
}
