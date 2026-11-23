import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { configuredGeminiKeys, geminiCooldownMs, geminiPoolStatus, markGeminiKey, resetGeminiPool, selectGeminiKeys } from '../llm-pool.js';

test('collects six indexed credentials in slot order and deduplicates legacy keys', () => {
  resetGeminiPool();
  const secrets = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`GEMINI_API_KEY_${index + 1}`, `key-${index + 1}`]));
  assert.deepEqual(configuredGeminiKeys({ secrets, env: { GEMINI_API_KEYS: 'key-1,key-2,key-3,key-4,key-5' } }),
    ['key-1', 'key-2', 'key-3', 'key-4', 'key-5', 'key-6']);
});

test('selects a single round-robin primary and returns remaining healthy slots for retry', () => {
  resetGeminiPool();
  const keys = ['a', 'b', 'c', 'd'];
  assert.deepEqual(selectGeminiKeys(keys, 4), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selectGeminiKeys(keys, 4), ['b', 'c', 'd', 'a']);
  assert.deepEqual(selectGeminiKeys(keys, 1), ['c']);
});

test('a fresh worker randomizes its first slot once, then continues round-robin', async (t) => {
  const random = t.mock.method(crypto, 'randomInt', () => 5);
  const fresh = await import('../llm-pool.js?fresh-worker-test');
  const keys = ['one', 'two', 'three', 'four', 'five', 'six'];
  assert.deepEqual(fresh.selectGeminiKeys(keys, 2), ['six', 'one']);
  assert.deepEqual(fresh.selectGeminiKeys(keys, 2), ['one', 'two']);
  assert.equal(random.mock.callCount(), 1);
});

test('429 cools down for 65 seconds; auth failures quarantine only the matching credential', () => {
  resetGeminiPool();
  const keys = ['first-key', 'second-key', 'third-key'];
  markGeminiKey(keys[0], 429, 10_000);
  markGeminiKey(keys[1], 403, 10_000);
  assert.deepEqual(geminiPoolStatus(keys, 10_001).map(({ slot, state, cooldown_until }) => ({ slot, state, cooldown_until })), [
    { slot: 1, state: 'cooldown', cooldown_until: 75_000 },
    { slot: 2, state: 'quarantined', cooldown_until: null },
    { slot: 3, state: 'ready', cooldown_until: null },
  ]);
  assert.deepEqual(selectGeminiKeys(keys, 3, 74_999), ['third-key']);
  assert.deepEqual(selectGeminiKeys(keys, 3, 75_000), ['third-key', 'first-key']);
});

test('API_KEY_INVALID quarantines; model availability errors do not', () => {
  resetGeminiPool();
  markGeminiKey('bad-key', 'API_KEY_INVALID');
  markGeminiKey('valid-key', 404);
  assert.deepEqual(geminiPoolStatus(['bad-key', 'valid-key']).map(({ state }) => state), ['quarantined', 'ready']);
});

test('reports how long until the first pooled key leaves its 429 cooldown', () => {
  resetGeminiPool();
  const keys = ['cool-a', 'cool-b'];
  markGeminiKey('cool-a', 429, 1_000);
  markGeminiKey('cool-b', 429, 5_000);
  assert.equal(geminiCooldownMs(keys, 2_000), 64_000);
  assert.equal(geminiCooldownMs(keys, 66_000), 0);
  assert.equal(geminiCooldownMs(['fresh'], 2_000), 0);
});
