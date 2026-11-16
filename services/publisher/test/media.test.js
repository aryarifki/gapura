import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSignedStorageRequest } from '../../common/storage-signature.js';
import { publishFormat, signedPublishImageUrl, signedPublishImageUrls } from '../media.js';

test('preserves single-image versus carousel publishing format', () => {
  assert.equal(publishFormat('single', 1), 'single');
  assert.equal(publishFormat('single', 2), 'carousel');
  assert.equal(publishFormat('carousel', 1), 'single');
});

test('rejects invalid media counts before making any publishing request', () => {
  for (const count of [0, -1, 1.5, NaN, 11]) {
    assert.throws(() => publishFormat('carousel', count), /slide/i);
  }
  assert.throws(() => publishFormat('video', 1), /format/i);
});

test('creates a signed, expiring media URL for the requested draft slide', () => {
  const url = new URL(signedPublishImageUrl({
    baseUrl: 'https://gapura.example', draftId: 20, slideNo: 1,
    signingSecret: 'a'.repeat(64), nowSeconds: 1000,
  }));
  assert.equal(url.pathname, '/media/drafts/20/slide_1.png');
  assert.equal(url.searchParams.get('expires'), '2800');
  assert.equal(isValidSignedStorageRequest(url.pathname.replace('/media/', '/storage/'), url.searchParams.get('expires'), url.searchParams.get('signature'), 'a'.repeat(64), 1001), true);
});

test('builds signed JPEG URLs for every slide so Meta can fetch publishable assets', () => {
  const urls = signedPublishImageUrls({
    baseUrl: 'https://gapura.example', draftId: 20, slideCount: 3,
    signingSecret: 'a'.repeat(64), nowSeconds: 1000,
  });
  assert.equal(urls.length, 3);
  for (const [index, value] of urls.entries()) {
    const url = new URL(value);
    assert.equal(url.pathname, `/media/drafts/20/slide_${index + 1}.jpg`);
    assert.equal(isValidSignedStorageRequest(url.pathname.replace('/media/', '/storage/'), url.searchParams.get('expires'), url.searchParams.get('signature'), 'a'.repeat(64), 1001), true);
  }
  assert.throws(() => signedPublishImageUrls({ baseUrl: 'https://gapura.example', draftId: 20, slideCount: 0, signingSecret: 'x' }), /slide/i);
});

test('refuses malformed draft/slide identifiers and missing signing credentials', () => {
  assert.throws(() => signedPublishImageUrl({ baseUrl: 'https://gapura.example', draftId: '../etc', slideNo: 1, signingSecret: 'x' }), /bilangan bulat positif/);
  assert.throws(() => signedPublishImageUrl({ baseUrl: 'https://gapura.example', draftId: 1, slideNo: 1, signingSecret: '' }), /secret/);
});
