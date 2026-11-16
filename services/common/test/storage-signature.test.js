import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedStorageUrl, isValidSignedStorageRequest } from '../storage-signature.js';

test('issues a short-lived signature for one rendered draft image', () => {
  const url = new URL(createSignedStorageUrl('https://gapura.example', '/storage/drafts/14/slide_2.png', 'a'.repeat(64), { ttlSeconds: 300, nowSeconds: 1000 }));
  assert.equal(url.pathname, '/storage/drafts/14/slide_2.png');
  assert.equal(url.searchParams.get('expires'), '1300');
  assert.equal(isValidSignedStorageRequest(url.pathname, url.searchParams.get('expires'), url.searchParams.get('signature'), 'a'.repeat(64), 1001), true);
});

test('rejects modified paths, expired signatures, excessive lifetime, and wrong secrets', () => {
  const url = new URL(createSignedStorageUrl('https://gapura.example', '/storage/drafts/14/slide_2.png', 'a'.repeat(64), { ttlSeconds: 300, nowSeconds: 1000 }));
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');
  assert.equal(isValidSignedStorageRequest('/storage/drafts/14/slide_1.png', expires, signature, 'a'.repeat(64), 1001), false);
  assert.equal(isValidSignedStorageRequest(url.pathname, expires, signature, 'b'.repeat(64), 1001), false);
  assert.equal(isValidSignedStorageRequest(url.pathname, expires, signature, 'a'.repeat(64), 1300), false);
  assert.equal(isValidSignedStorageRequest(url.pathname, 5000, signature, 'a'.repeat(64), 1000), false);
  assert.equal(isValidSignedStorageRequest('/storage/../../.env', expires, signature, 'a'.repeat(64), 1001), false);
});

test('clamps signed URL lifetime to one hour', () => {
  const url = new URL(createSignedStorageUrl('https://gapura.example', '/storage/drafts/1/slide_1.png', 'secret', { ttlSeconds: 9000, nowSeconds: 500 }));
  assert.equal(url.searchParams.get('expires'), '4100');
});
