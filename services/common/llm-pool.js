import crypto from 'node:crypto';

const keyState = new Map();
const cooldownState = new Map();
const providerCooldowns = new Map();
let cursor;

const normal = (value) => typeof value === 'string' ? value.trim() : '';
const bucket = (key, model = '') => (model ? `${key}\0${model}` : key);

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

function slot(key) { if (!keyState.has(key)) keyState.set(key, { quarantined: false }); return keyState.get(key); }
function cooldownUntilFor(key, model = '') {
  return Math.max(cooldownState.get(bucket(key, '')) || 0, model ? (cooldownState.get(bucket(key, model)) || 0) : 0);
}

export function selectGeminiKeys(keys, limit = 1, now = Date.now(), { model = '' } = {}) {
  const unique = [...new Set((keys || []).map(normal).filter(Boolean))];
  if (!unique.length) return [];
  // Fresh workers must not all spend their two attempts on the same slots.
  const start = (cursor ?? crypto.randomInt(unique.length)) % unique.length;
  const ordered = Array.from({ length: unique.length }, (_, i) => unique[(start + i) % unique.length]);
  const usable = ordered.filter((key) => !slot(key).quarantined && cooldownUntilFor(key, model) <= now);
  // One API call advances the primary slot by exactly one, independent of how
  // many healthy alternatives are retained for immediate in-call failover.
  cursor = (start + 1) % unique.length;
  return usable.slice(0, Math.max(0, Math.min(Number(limit) || 0, usable.length)));
}

export function markGeminiKey(key, status, now = Date.now(), { model = '', cooldownMs = 65_000 } = {}) {
  if (!key) return;
  const s = slot(key);
  if (status === 429) cooldownState.set(bucket(key, model), now + Math.max(1_000, Number(cooldownMs) || 65_000));
  if (status === 401 || status === 403 || status === 'API_KEY_INVALID') s.quarantined = true;
}

export function geminiPoolStatus(keys, now = Date.now(), { model = '' } = {}) {
  return keys.map((key, index) => {
    const s = slot(key);
    let until = cooldownUntilFor(key, model);
    if (!model) {
      for (const [entryKey, entryUntil] of cooldownState.entries()) {
        if (entryKey.startsWith(`${key}\0`) && entryUntil > until) until = entryUntil;
      }
    }
    return {
      slot: index + 1,
      state: s.quarantined ? 'quarantined' : until > now ? 'cooldown' : 'ready',
      cooldown_until: until > 0 ? until : null,
    };
  });
}

/** Milliseconds until the first pooled key leaves its 429 cooldown; 0 when one is ready. */
export function geminiCooldownMs(keys, now = Date.now(), { model = '' } = {}) {
  const unique = [...new Set((keys || []).map(normal).filter(Boolean))];
  if (!unique.length) return 0;
  if (unique.some((key) => !slot(key).quarantined && cooldownUntilFor(key, model) <= now)) return 0;
  const pending = unique.filter((key) => !slot(key).quarantined)
    .map((key) => cooldownUntilFor(key, model) - now)
    .filter((ms) => ms > 0);
  return pending.length ? Math.min(...pending) : 0;
}

export function markProviderCooldown(providerId, cooldownMs = 3_600_000, now = Date.now()) {
  if (!providerId) return;
  providerCooldowns.set(String(providerId), now + Math.max(1_000, Number(cooldownMs) || 3_600_000));
}

export function isProviderCooled(providerId, now = Date.now()) {
  return (providerCooldowns.get(String(providerId)) || 0) > now;
}

export function resetGeminiPool() {
  keyState.clear();
  cooldownState.clear();
  providerCooldowns.clear();
  cursor = 0;
}
