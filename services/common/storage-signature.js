import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_TTL_SECONDS = 3600;

function signatureFor(path, expires, secret) {
  return createHmac('sha256', secret).update(`${path}\n${expires}`).digest('hex');
}

export function createSignedStorageUrl(baseUrl, path, secret, { ttlSeconds = 900, nowSeconds = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret || !String(path).startsWith('/storage/drafts/')) throw new Error('Signed storage URL requires a secret and a draft asset path.');
  const expires = nowSeconds + Math.max(1, Math.min(MAX_TTL_SECONDS, Math.floor(ttlSeconds)));
  const signature = signatureFor(path, expires, secret);
  const url = new URL(path, baseUrl);
  url.searchParams.set('expires', String(expires));
  url.searchParams.set('signature', signature);
  return url.toString();
}

export function isValidSignedStorageRequest(path, expiresValue, signature, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || !/^\/storage\/drafts\/\d+\/slide_\d+\.(png|jpg)$/.test(path)) return false;
  const expires = Number(expiresValue);
  if (!Number.isInteger(expires) || expires <= nowSeconds || expires > nowSeconds + MAX_TTL_SECONDS) return false;
  const expected = Buffer.from(signatureFor(path, expires, secret), 'hex');
  let supplied;
  try { supplied = Buffer.from(String(signature), 'hex'); } catch { return false; }
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
