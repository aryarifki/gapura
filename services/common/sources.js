import { isIP } from 'node:net';

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export function validatePublicSourceUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return 'URL sumber tidak valid.'; }
  if (url.protocol !== 'https:' || url.username || url.password) return 'Sumber harus menggunakan URL HTTPS tanpa kredensial.';
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return 'Host sumber lokal/internal tidak diizinkan.';
  }
  const version = isIP(host);
  if (version === 4 && isPrivateIpv4(host)) return 'Alamat IP privat/reserved tidak diizinkan sebagai sumber.';
  if (version === 6 && (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:'))) {
    return 'Alamat IPv6 privat/reserved tidak diizinkan sebagai sumber.';
  }
  return null;
}

export function parsePublicSourceUrl(value) {
  const error = validatePublicSourceUrl(value);
  if (error) throw new Error(error);
  const url = new URL(value);
  return { url: url.toString(), sourceName: url.hostname.replace(/^www\./, '') };
}
