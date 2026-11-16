import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { validatePublicSourceUrl } from '../common/sources.js';
import { extractArticleDocument, resolvePublisherArticleUrl } from './article.js';

const USER_AGENT = 'GapuraMediaBot/3.1 (+https://gapura.avenia.my.id)';
const ROBOTS_BYTES = 64 * 1024;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_LIMIT = 100;

function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  // Only global unicast, excluding documentation and transition ranges. Mapped
  // IPv4, loopback, link-local and ULA never reach the socket.
  const expanded = address.toLowerCase().split(':');
  const first = parseInt(expanded[0] || '0', 16);
  const second = parseInt(expanded[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002
    && !(first === 0x2001 && (second < 0x0200 || second === 0x0db8));
}

function cacheSet(cache, key, value) {
  if (!cache.has(key) && cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
}

function header(response, name) {
  return response.headers?.get?.(name) || response.headers?.[name] || '';
}

function robotsPath(value) {
  return value.replace(/%([a-f0-9]{2})/giu, (match, hex) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9._~-]/u.test(char) ? char : match.toUpperCase();
  });
}

export function robotsAllows(text, value, userAgent = 'GapuraMediaBot') {
  const groups = [];
  let group = null;
  for (const raw of String(text || '').split(/\r?\n/u)) {
    const line = raw.split('#')[0].trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const field = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (!group || group.hasDirectives) { group = { agents: [], rules: [], hasDirectives: false }; groups.push(group); }
      group.agents.push(field.toLowerCase());
    } else if (group && (key === 'allow' || key === 'disallow')) {
      group.hasDirectives = true;
      if (field) group.rules.push({ allow: key === 'allow', path: field });
    }
  }
  const agent = userAgent.toLowerCase();
  const specificity = (item) => Math.max(-1, ...item.agents.map((name) => name === '*' ? 0 : name && agent.includes(name) ? name.length : -1));
  const best = Math.max(-1, ...groups.map(specificity));
  if (best < 0) return true;
  const parsed = new URL(value);
  const target = robotsPath(parsed.pathname + parsed.search);
  const matches = groups.filter((item) => specificity(item) === best).flatMap((item) => item.rules).filter((rule) => {
    const terminal = rule.path.endsWith('$');
    const pattern = robotsPath(terminal ? rule.path.slice(0, -1) : rule.path).split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${terminal ? '$' : ''}`, 'u').test(target);
  }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return !matches.length || matches[0].allow;
}

export function requestArticleHttps({ url, address, family, headers, maxBytes = 2 * 1024 * 1024, timeoutMs = 12000 }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = httpsRequest(target, {
      method: 'GET', agent: false, headers: { ...headers, 'Accept-Encoding': 'identity' },
      lookup(_host, options, callback) {
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (res) => {
      const chunks = [];
      let bytes = 0;
      let ended = false;
      res.on('error', reject);
      res.once('aborted', () => reject(Object.assign(new Error('Response aborted'), { code: 'response_aborted' })));
      res.once('close', () => {
        if (!ended) reject(Object.assign(new Error('Response closed before end'), { code: 'response_aborted' }));
      });
      if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
        res.destroy(Object.assign(new Error('Unsupported content encoding'), { code: 'response_encoding_unsupported' }));
      }
      if (Number(res.headers['content-length']) > maxBytes) res.destroy(Object.assign(new Error('Response too large'), { code: 'response_too_large' }));
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) res.destroy(Object.assign(new Error('Response too large'), { code: 'response_too_large' }));
        else chunks.push(chunk);
      });
      res.on('end', () => {
        ended = true;
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('Request timed out'), { code: 'request_timeout' })), timeoutMs);
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
    req.end();
  });
}

function failure(url, publisher, status, errorCode) {
  return { title: '', publisher, canonical_url: url, published_at: null, updated_at: null, body: '', paragraphs: [], images: [], extraction: { kind: null, status, error_code: errorCode } };
}

export function createArticleReader({ requestImpl = requestArticleHttps, lookupImpl = lookup, now = Date.now, maxBytes = 2 * 1024 * 1024, maxRedirects = 3, timeoutMs = 12000, totalTimeoutMs = 45000 } = {}) {
  const documents = new Map();
  const robots = new Map();

  function remaining(deadline) {
    const budget = Math.min(timeoutMs, deadline - now());
    if (budget <= 0) throw Object.assign(new Error('Article deadline exceeded'), { code: 'request_timeout' });
    return budget;
  }

  async function resolvePublic(value, deadline) {
    const budget = remaining(deadline);
    if (typeof value !== 'string' || validatePublicSourceUrl(value)) throw new Error('invalid_public_url');
    const parsed = new URL(value);
    if (parsed.port && parsed.port !== '443') throw new Error('port_not_allowed');
    parsed.hash = '';
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    let addresses;
    if (isIP(hostname)) addresses = [{ address: hostname, family: isIP(hostname) }];
    else {
      let timer;
      try {
        addresses = await Promise.race([
          lookupImpl(hostname, { all: true, verbatim: true }),
          new Promise((_resolve, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('DNS timed out'), { code: 'request_timeout' })), budget); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    remaining(deadline);
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => !publicAddress(entry.address))) throw new Error('private_or_mixed_dns');
    return { url: parsed.toString(), address: addresses[0].address, family: isIP(addresses[0].address) };
  }

  async function robotsAllowed(value, deadline) {
    const origin = new URL(value).origin;
    const cached = robots.get(origin);
    if (cached && cached.expiresAt > now()) return cached.allowed && robotsAllows(cached.text, value);
    let result;
    try {
      const target = await resolvePublic(`${origin}/robots.txt`, deadline);
      result = await requestImpl({ ...target, headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain' }, maxBytes: ROBOTS_BYTES, timeoutMs: remaining(deadline) });
      if (Buffer.byteLength(result.body || '') > ROBOTS_BYTES) throw new Error('robots_too_large');
    } catch (error) {
      if (error.code === 'request_timeout') throw error;
      cacheSet(robots, origin, { allowed: false, text: '', expiresAt: now() + CACHE_TTL_MS }); return false;
    }
    const allowed = [404, 410].includes(result.status) || result.status === 200;
    const text = result.status === 200 ? Buffer.from(result.body || '').toString('utf8') : '';
    cacheSet(robots, origin, { allowed, text, expiresAt: now() + CACHE_TTL_MS });
    return allowed && robotsAllows(text, value);
  }

  async function read({ url, publisher = '', publisherUrl = '', articleSelectors = [], refresh = false } = {}) {
    const original = typeof url === 'string' ? url : '';
    const deadline = now() + totalTimeoutMs;
    let current;
    try { current = await resolvePublic(original, deadline); }
    catch (error) { return failure(original, publisher, error.code === 'request_timeout' ? 'unavailable' : 'access_denied', error.code === 'request_timeout' ? 'request_timeout' : 'url_or_dns_not_public'); }
    const key = JSON.stringify([current.url, publisher, publisherUrl, articleSelectors]);
    const cached = documents.get(key);
    if (!refresh && cached && cached.expiresAt > now()) return structuredClone(cached.document);
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      try {
        remaining(deadline);
        if (!await robotsAllowed(current.url, deadline)) return failure(current.url, publisher, 'robots_disallowed', 'robots_disallowed');
      } catch { return failure(current.url, publisher, 'unavailable', 'request_timeout'); }
      let response;
      try {
        response = await requestImpl({ ...current, headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' }, maxBytes, timeoutMs: remaining(deadline) });
        remaining(deadline);
      }
      catch (error) { return failure(current.url, publisher, error.code === 'response_too_large' ? 'parse_failed' : 'unavailable', ['response_too_large', 'response_encoding_unsupported', 'request_timeout', 'response_aborted'].includes(error.code) ? error.code : 'request_failed'); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects === maxRedirects || !header(response, 'location')) return failure(current.url, publisher, 'parse_failed', 'redirect_limit');
        try {
          const destination = new URL(header(response, 'location'), current.url);
          if ((destination.pathname === '/' || /^\/(?:index|default)\.(?:html?|php|aspx?)$/iu.test(destination.pathname))
            && !destination.search && new URL(original).pathname !== '/') return failure(current.url, publisher, 'parse_failed', 'redirect_homepage');
          current = await resolvePublic(destination.toString(), deadline);
        }
        catch (error) { return failure(current.url, publisher, error.code === 'request_timeout' ? 'unavailable' : 'access_denied', error.code === 'request_timeout' ? 'request_timeout' : 'redirect_not_public'); }
        continue;
      }
      if (response.status !== 200) return failure(current.url, publisher, response.status === 429 ? 'rate_limited' : [401, 403].includes(response.status) ? 'access_denied' : 'unavailable', `http_${response.status}`);
      const type = header(response, 'content-type');
      if (!/^\s*(text\/html|application\/xhtml\+xml)(?:;|$)/iu.test(type)) return failure(current.url, publisher, 'parse_failed', 'not_html');
      const body = Buffer.from(response.body || '');
      if (!body.length || body.length > maxBytes) return failure(current.url, publisher, 'parse_failed', body.length ? 'response_too_large' : 'empty_response');
      const charset = /charset\s*=\s*["']?([\w-]+)/iu.exec(type)?.[1];
      const document = extractArticleDocument(body, { url: current.url, publisher, articleSelectors, charset });
      if (new URL(current.url).hostname === 'news.google.com') {
        if (['paywall', 'access_denied'].includes(document.extraction.status)) return document;
        const articleUrl = resolvePublisherArticleUrl(body, { url: current.url, publisherUrl, charset });
        if (!articleUrl) return failure(current.url, publisher, 'parse_failed', 'aggregator_unresolved');
        if (redirects === maxRedirects) return failure(current.url, publisher, 'parse_failed', 'redirect_limit');
        try { current = await resolvePublic(articleUrl, deadline); }
        catch (error) { return failure(current.url, publisher, error.code === 'request_timeout' ? 'unavailable' : 'access_denied', error.code === 'request_timeout' ? 'request_timeout' : 'redirect_not_public'); }
        continue;
      }
      cacheSet(documents, key, { document: structuredClone(document), expiresAt: now() + CACHE_TTL_MS });
      return document;
    }
    return failure(original, publisher, 'parse_failed', 'redirect_limit');
  }
  return { read, clearCache() { documents.clear(); robots.clear(); } };
}
