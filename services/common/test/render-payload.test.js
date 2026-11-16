import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPayload } from '../images.js';

test('embeds a bounded local image payload and strips the external URL before renderer transit', async () => {
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Headline', data: { image_url: 'https://pbs.twimg.com/media/a.jpg', title: 'Headline' } }];
  const payload = await renderPayload(slides, {
    fetchImpl: async () => new Response(Uint8Array.from([1, 2, 3]), {
      headers: { 'content-type': 'image/png', 'content-length': '3' },
    }),
  });
  assert.equal(payload[0].data.image_data, 'data:image/png;base64,AQID');
  assert.equal(Object.hasOwn(payload[0].data, 'image_url'), false);
  assert.equal(slides[0].data.image_url, 'https://pbs.twimg.com/media/a.jpg');
});

test('failed source image download falls back to typography without forwarding a remote URL', async () => {
  const [slide] = await renderPayload([{ layout: 'cover-focus', teks: 'Headline', data: { image_url: 'https://pbs.twimg.com/media/a.jpg' } }], { fetchImpl: async () => new Response('missing', { status: 404 }) });
  assert.equal(slide.data.image_url, undefined);
  assert.equal(slide.data.image_data, undefined);
});
