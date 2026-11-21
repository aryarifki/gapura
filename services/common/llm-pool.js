import crypto from 'node:crypto';

const state = new Map();

const normal = (value) => typeof value === 'string' ? value.trim() : '';

export function configuredGeminiKeys({ env = process.env, secrets = {}, inlineKey = '' } = {}) {
  if (normal(inlineKey)) return [normal(inlineKey)];
  const indexed = Object.keys({ ...secrets, ...env })
    .filter((name) => /^GEMINI_API_KEY_\d+$/u.test(name))
    .sort((a, b) => Number(a.slice(15)) - Number(b.slice(15)))
    .map((name) => secrets[name] || env[name]);
  const configured = [secrets.GEMINI_API_KEYS, env.GEMINI_API_KEYS, ...indexed].flatMap((value) => String(value || '').split(',').map(normal).filter(Boolean));
  const values = configured.length ? configured : [secrets.GEMINI_API_KEY, env.GEMINI_API_KEY, secrets.GOOGLE_API_KEY, env.GOOGLE_API_KEY];
  return [...new Set(values.flatMap((value) => String(value || '').split(',').map(normal).filter(Boolean)))];
}

function slot(key) { if (!state.has(key)) state.set(key, { cooldownUntil: 0, quarantined: false }); return state.get(key); }
export function selectGeminiKeys(keys, limit = 1, now = Date.now()) {
  const unique = [...new Set((keys || []).map(normal).filter(Boolean))];
  if (!unique.length) return [];
  // Fresh workers must not all spend their two attempts on the same slots.
  const start = (state.cursor ?? crypto.randomInt(unique.length)) % unique.length;
  const ordered = Array.from({ length: unique.length }, (_, i) => unique[(start + i) % unique.length]);
  const usable = ordered.filter((key) => { const s = slot(key); return !s.quarantined && s.cooldownUntil <= now; });
  // One API call advances the primary slot by exactly one, independent of how
  // many healthy alternatives are retained for immediate in-call failover.
  state.cursor = (start + 1) % unique.length;
  return usable.slice(0, Math.max(0, Math.min(Number(limit) || 0, usable.length)));
}
export function markGeminiKey(key, status, now = Date.now()) {
  if (!key) return;
  const s = slot(key);
  if (status === 429) s.cooldownUntil = now + 65_000;
  if (status === 401 || status === 403 || status === 'API_KEY_INVALID') s.quarantined = true;
}
export function geminiPoolStatus(keys, now = Date.now()) {
  return keys.map((key, index) => { const s = slot(key); return { slot: index + 1, state: s.quarantined ? 'quarantined' : s.cooldownUntil > now ? 'cooldown' : 'ready', cooldown_until: s.cooldownUntil || null }; });
}
export function resetGeminiPool() { state.clear(); state.cursor = 0; }
