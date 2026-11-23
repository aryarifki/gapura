import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MetaApiError, createFacebookPublisher, createGraphClient,
  createInstagramPublisher, createThreadsPublisher, fetchPermalink,
} from '../meta.js';

const IMG = 'https://gapura.example/media/drafts/7/slide_1.jpg';
const IMG2 = 'https://gapura.example/media/drafts/7/slide_2.jpg';

function recorder(responses) {
  const calls = [];
  const client = {
    calls,
    async request(endpoint, options = {}) {
      calls.push({ endpoint, ...options });
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return typeof next === 'function' ? next(endpoint, options) : next;
    },
  };
  return client;
}

test('graph client uses a bearer header and refuses a missing token', async () => {
  let captured;
  const client = createGraphClient({
    accessToken: 'page-token', version: 'v23.0',
    fetchImpl: async (url, init) => { captured = { url, init }; return Response.json({ id: '42' }); },
  });
  await client.request('1023/photos', { method: 'POST', body: { url: IMG } });
  assert.equal(captured.url, 'https://graph.facebook.com/v23.0/1023/photos');
  assert.equal(captured.init.headers.Authorization, 'Bearer page-token');
  assert.equal(captured.init.body, 'url=https%3A%2F%2Fgapura.example%2Fmedia%2Fdrafts%2F7%2Fslide_1.jpg');
  assert.equal(new URL(captured.url).searchParams.has('access_token'), false);
  assert.throws(() => createGraphClient({ accessToken: '' }), /access token/i);
});

test('graph client classifies provider errors without echoing the token', async () => {
  const client = createGraphClient({
    accessToken: 'super-secret-token',
    fetchImpl: async () => Response.json({ error: { code: 190, message: 'Invalid OAuth access token super-secret-token' } }, { status: 401 }),
  });
  await assert.rejects(() => client.request('me'), (error) => {
    assert.equal(error instanceof MetaApiError, true);
    assert.equal(error.retryable, false);
    assert.equal(error.code, 190);
    assert.match(error.message, /401/);
    assert.equal(error.message.includes('super-secret-token'), false);
    return true;
  });
});

test('graph client marks 429 and 5xx as retryable and an HTML body as retryable', async () => {
  const tooMany = createGraphClient({ accessToken: 't', fetchImpl: async () => new Response('slow down', { status: 429 }) });
  await assert.rejects(() => tooMany.request('me'), (error) => error.retryable === true);
  const html = createGraphClient({ accessToken: 't', fetchImpl: async () => new Response('<html>Just a moment...</html>', { status: 200 }) });
  await assert.rejects(() => html.request('me'), (error) => error.retryable === true && /non-JSON/.test(error.message));
  const transientTimeout = createGraphClient({
    accessToken: 't',
    fetchImpl: async () => Response.json({ error: { code: -2, message: 'Timeout' } }, { status: 400 }),
  });
  await assert.rejects(() => transientTimeout.request('me'), (error) => error.retryable === true && error.code === -2);
});

test('Instagram publishes a single image after the container is ready', async () => {
  const client = recorder([
    { id: 'container-1' },
    { status_code: 'IN_PROGRESS' },
    { status_code: 'FINISHED' },
    { id: 'media-9' },
  ]);
  const publisher = createInstagramPublisher({ client, igUserId: '1784', pollDelay: async () => {} });
  const result = await publisher.publish({ imageUrls: [IMG], caption: 'Halo' });
  assert.deepEqual(result, { remoteId: 'media-9', containerId: 'container-1' });
  assert.deepEqual(client.calls[0].body, { image_url: IMG, caption: 'Halo' });
  assert.equal(client.calls[1].endpoint, 'container-1');
  assert.deepEqual(client.calls[3].body, { creation_id: 'container-1' });
});

test('Instagram builds child containers plus a captioned carousel parent', async () => {
  const client = recorder([
    { id: 'child-1' }, { id: 'child-2' },
    { id: 'parent-1' },
    { status_code: 'FINISHED' },
    { id: 'media-10' },
  ]);
  const publisher = createInstagramPublisher({ client, igUserId: '1784', pollDelay: async () => {} });
  const result = await publisher.publish({ imageUrls: [IMG, IMG2], caption: 'Dua slide' });
  assert.equal(result.remoteId, 'media-10');
  assert.deepEqual(client.calls[0].body, { image_url: IMG, is_carousel_item: 'true' });
  assert.deepEqual(client.calls[2].body, { media_type: 'CAROUSEL', children: 'child-1,child-2', caption: 'Dua slide' });
});

test('Instagram rejects more than ten images and a failed container status', async () => {
  const publisher = createInstagramPublisher({ client: recorder([]), igUserId: '1784', pollDelay: async () => {} });
  await assert.rejects(() => publisher.publish({ imageUrls: Array.from({ length: 11 }, () => IMG) }), /melebihi batas/);

  const failing = createInstagramPublisher({
    client: recorder([{ id: 'c' }, { status_code: 'ERROR' }]), igUserId: '1784', pollDelay: async () => {},
  });
  await assert.rejects(() => failing.publish({ imageUrls: [IMG] }), (error) => error instanceof MetaApiError && error.retryable === false);
});

test('Instagram marks a media_publish transport failure as an uncertain outcome', async () => {
  const client = recorder([{ id: 'c' }, { status_code: 'FINISHED' }, new MetaApiError('socket hang up', { retryable: true })]);
  const publisher = createInstagramPublisher({ client, igUserId: '1784', pollDelay: async () => {} });
  await assert.rejects(() => publisher.publish({ imageUrls: [IMG] }), (error) => error.uncertain === true);
});

test('Facebook publishes a single photo and a multi-photo feed post', async () => {
  const single = recorder([{ id: 'photo-1', post_id: 'post-1' }]);
  const singlePublisher = createFacebookPublisher({ client: single, pageId: '1023' });
  assert.deepEqual(await singlePublisher.publish({ imageUrls: [IMG], caption: 'Halo' }), { remoteId: 'post-1', containerId: 'photo-1' });
  assert.deepEqual(single.calls[0].body, { url: IMG, caption: 'Halo', published: 'true' });

  const multi = recorder([{ id: 'photo-1' }, { id: 'photo-2' }, { id: 'feed-1' }]);
  const multiPublisher = createFacebookPublisher({ client: multi, pageId: '1023' });
  const result = await multiPublisher.publish({ imageUrls: [IMG, IMG2], caption: 'Dua foto' });
  assert.equal(result.remoteId, 'feed-1');
  assert.deepEqual(multi.calls[0].body, { url: IMG, published: 'false' });
  assert.deepEqual(JSON.parse(multi.calls[2].body.attached_media), [{ media_fbid: 'photo-1' }, { media_fbid: 'photo-2' }]);
  assert.equal(multi.calls[2].body.message, 'Dua foto');
});

test('Facebook single-photo timeouts are uncertain because the photo may already be public', async () => {
  const client = recorder([new MetaApiError('timeout', { retryable: true })]);
  const publisher = createFacebookPublisher({ client, pageId: '1023' });
  await assert.rejects(() => publisher.publish({ imageUrls: [IMG], caption: 'Halo' }), (error) => error.uncertain === true);
  assert.equal(client.calls.length, 1);
});

test('Threads enforces the caption limit and publishes a carousel', async () => {
  const tooLong = createThreadsPublisher({ client: recorder([]), threadsUserId: '99', pollDelay: async () => {} });
  await assert.rejects(() => tooLong.publish({ imageUrls: [IMG], caption: 'x'.repeat(501) }), /500/);

  const client = recorder([
    { id: 'child-1' }, { id: 'child-2' }, { id: 'parent-1' },
    { status: 'FINISHED' },
    { id: 'threads-1' },
  ]);
  const publisher = createThreadsPublisher({ client, threadsUserId: '99', pollDelay: async () => {} });
  const result = await publisher.publish({ imageUrls: [IMG, IMG2], caption: 'Halo Threads' });
  assert.deepEqual(result, { remoteId: 'threads-1', containerId: 'parent-1' });
  assert.deepEqual(client.calls[2].body, { media_type: 'CAROUSEL', children: 'child-1,child-2', text: 'Halo Threads' });
  assert.deepEqual(client.calls[4].body, { creation_id: 'parent-1' });
});

test('Threads marks threads_publish failures as uncertain and a permalink lookup failure as null', async () => {
  const client = recorder([{ id: 'c' }, { status: 'FINISHED' }, new MetaApiError('timeout', { retryable: true })]);
  const publisher = createThreadsPublisher({ client, threadsUserId: '99', pollDelay: async () => {} });
  await assert.rejects(() => publisher.publish({ imageUrls: [IMG], caption: 'x' }), (error) => error.uncertain === true);

  const permalinkClient = recorder([{ permalink: 'https://www.threads.net/@gapuramedia/post/1' }, new MetaApiError('nope')]);
  assert.equal(await fetchPermalink(permalinkClient, 'threads-1'), 'https://www.threads.net/@gapuramedia/post/1');
  assert.equal(await fetchPermalink(permalinkClient, 'threads-2'), null);
});

test('Facebook looks up permalink_url while Instagram and Threads use permalink', async () => {
  const client = recorder([{ permalink_url: 'https://www.facebook.com/1023_9' }]);
  assert.equal(await fetchPermalink(client, '1023_9', { platform: 'facebook' }), 'https://www.facebook.com/1023_9');
  assert.deepEqual(client.calls[0].query, { fields: 'permalink_url' });
});
