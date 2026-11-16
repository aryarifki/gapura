import test from 'node:test';
import assert from 'node:assert/strict';
import { imageUrlToDataUri, isAllowedImageUrl, prepareSlideImages } from '../images.js';

function response(bytes, { type = 'image/jpeg', url = 'https://pbs.twimg.com/media/a.jpg', length } = {}) {
  const headers = new Headers({ 'content-type': type });
  if (length !== undefined) headers.set('content-length', String(length));
  return new Response(Uint8Array.from(bytes), { status: 200, headers, url });
}

test('accepts only HTTPS images from the media allowlist', () => {
  assert.equal(isAllowedImageUrl('https://pbs.twimg.com/media/a.jpg'), true);
  assert.equal(isAllowedImageUrl('https://images.unsplash.com/photo-1'), true);
  assert.equal(isAllowedImageUrl('http://pbs.twimg.com/media/a.jpg'), false);
  assert.equal(isAllowedImageUrl('https://127.0.0.1/private.jpg'), false);
  assert.equal(isAllowedImageUrl('https://evil.example/pbs.twimg.com.jpg'), false);
});

test('converts permitted image bytes into a data URI without leaking URL content', async () => {
  const uri = await imageUrlToDataUri('https://pbs.twimg.com/media/a.jpg', { fetchImpl: async () => response([1, 2, 3]) });
  assert.equal(uri, 'data:image/jpeg;base64,AQID');
});

test('rejects non-image data and oversized image responses', async () => {
  assert.equal(await imageUrlToDataUri('https://pbs.twimg.com/media/a.jpg', {
    fetchImpl: async () => response([1], { type: 'text/html' }),
  }), null);
  assert.equal(await imageUrlToDataUri('https://pbs.twimg.com/media/a.jpg', {
    fetchImpl: async () => ({
      ok: true,
      url: 'https://pbs.twimg.com/media/a.jpg',
      headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(5 * 1024 * 1024) }),
      arrayBuffer: async () => Uint8Array.from([1]).buffer,
    }),
  }), null);
});

test('rejects a redirected image response whose final host is not allowed', async () => {
  const fetchImpl = async () => ({
    ok: true,
    url: 'https://attacker.example/redirect.jpg',
    headers: new Headers({ 'content-type': 'image/jpeg' }),
    arrayBuffer: async () => Uint8Array.from([1]).buffer,
  });
  assert.equal(await imageUrlToDataUri('https://pbs.twimg.com/media/a.jpg', { fetchImpl }), null);
});

test('enriches only selected slides and leaves original image URL available', async () => {
  const input = [
    { layout: 'cover-focus', data: { image_url: 'https://pbs.twimg.com/media/a.jpg' } },
    { layout: 'text', data: { title: 'No photo' } },
  ];
  const result = await prepareSlideImages(input, { fetchImpl: async () => response([0, 255]) });
  assert.equal(result[0].data.image_url, input[0].data.image_url);
  assert.equal(result[0].data.image_data, 'data:image/jpeg;base64,AP8=');
  assert.equal(result[1], input[1]);
});
