// Platform adapters for Meta publishing. All network access goes through an
// injected Graph client so every branch is testable without a live token.
import { setTimeout as sleep } from 'node:timers/promises';

export const META_GRAPH_BASE = 'https://graph.facebook.com';
export const THREADS_GRAPH_BASE = 'https://graph.threads.com';

export class MetaApiError extends Error {
  constructor(message, { status = 0, code = null, retryable = false, uncertain = false } = {}) {
    super(message);
    this.name = 'MetaApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.uncertain = uncertain;
  }
}

const RETRYABLE_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export function createGraphClient({
  fetchImpl = globalThis.fetch, accessToken, version = 'v23.0',
  baseUrl = META_GRAPH_BASE, timeoutMs = 20000,
} = {}) {
  if (!accessToken) throw new Error('Meta access token belum dikonfigurasi.');
  const root = String(baseUrl).replace(/\/+$/, '');
  const apiVersion = String(version || '').replace(/^\/+|\/+$/g, '');

  async function request(endpoint, { method = 'GET', query = {}, body = null } = {}) {
    const url = new URL(`${root}/${apiVersion}/${String(endpoint).replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const init = {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 20000)),
    };
    if (body) {
      init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(body).toString();
    }
    let response;
    try {
      response = await fetchImpl(url.toString(), init);
    } catch (error) {
      throw new MetaApiError(`Meta tidak dapat dihubungi: ${error.name || 'network error'}`, { retryable: true });
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new MetaApiError(`Meta mengembalikan respons non-JSON (HTTP ${response.status}).`, {
        status: response.status,
        retryable: response.ok || response.status === 408 || response.status === 429 || response.status >= 500,
      });
    }
    if (!response.ok || data?.error) {
      const providerError = data?.error || {};
      const code = Number(providerError.code);
      const message = String(providerError.message || 'tanpa pesan').split(accessToken).join('[REDACTED]');
      throw new MetaApiError(
        `Meta API menolak permintaan (HTTP ${response.status}${Number.isFinite(code) ? `, code ${code}` : ''}): ${message}`,
        {
          status: response.status,
          code: Number.isFinite(code) ? code : null,
          retryable: response.status === 429 || response.status >= 500 || RETRYABLE_CODES.has(code),
        },
      );
    }
    return data;
  }

  return { request };
}

function assertImageUrls(imageUrls, max) {
  if (!Array.isArray(imageUrls) || imageUrls.length < 1) throw new Error('Publikasi membutuhkan minimal satu gambar.');
  if (imageUrls.length > max) throw new Error(`Jumlah gambar melebihi batas platform (${max}).`);
  for (const url of imageUrls) {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) throw new Error('URL gambar publikasi wajib HTTPS.');
  }
}

async function waitForContainer(client, containerId, { fields, readyValue, pendingValues, pollDelay, maxPolls, label }) {
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const status = await client.request(containerId, { query: { fields } });
    const value = fields.includes('status_code') ? status.status_code : status.status;
    if (value === readyValue) return;
    if (!pendingValues.includes(value)) {
      throw new MetaApiError(`${label} menolak container (status ${value || 'tidak diketahui'}).`, { retryable: false });
    }
    if (attempt === maxPolls - 1) break;
    await pollDelay(Math.min(1000 * (attempt + 1), 5000));
  }
  throw new MetaApiError(`${label} belum siap setelah ${maxPolls} pemeriksaan.`, { retryable: true });
}

export function createInstagramPublisher({ client, igUserId, pollDelay = sleep, maxPolls = 10 }) {
  const account = String(igUserId || '').trim();
  if (!account) throw new Error('Instagram business account ID belum dikonfigurasi.');

  async function publish({ imageUrls, caption = '', beforePublish = async () => {} }) {
    assertImageUrls(imageUrls, 10);
    const single = imageUrls.length === 1;
    const children = [];
    for (const imageUrl of imageUrls) {
      const container = await client.request(`${account}/media`, {
        method: 'POST',
        body: { image_url: imageUrl, ...(single ? { caption } : { is_carousel_item: 'true' }) },
      });
      if (!container?.id) throw new MetaApiError('Meta tidak mengembalikan media container id.');
      children.push(container.id);
    }
    let creationId = children[0];
    if (!single) {
      const parent = await client.request(`${account}/media`, {
        method: 'POST',
        body: { media_type: 'CAROUSEL', children: children.join(','), caption },
      });
      if (!parent?.id) throw new MetaApiError('Meta tidak mengembalikan carousel container id.');
      creationId = parent.id;
    }
    await waitForContainer(client, creationId, {
      fields: 'status_code', readyValue: 'FINISHED', pendingValues: ['IN_PROGRESS'], pollDelay, maxPolls, label: 'Instagram',
    });
    await beforePublish(creationId);
    // Past this point a transport failure can still mean the post went live.
    let published;
    try {
      published = await client.request(`${account}/media_publish`, { method: 'POST', body: { creation_id: creationId } });
    } catch (error) {
      error.uncertain = true;
      throw error;
    }
    if (!published?.id) throw new MetaApiError('Meta tidak mengembalikan media id hasil publikasi.', { uncertain: true });
    return { remoteId: published.id, containerId: creationId };
  }

  return { platform: 'instagram', accountId: account, publish };
}

export function createFacebookPublisher({ client, pageId, pollDelay = sleep, maxPolls = 10 }) {
  const page = String(pageId || '').trim();
  if (!page) throw new Error('Facebook Page ID belum dikonfigurasi.');

  async function publish({ imageUrls, caption = '', beforePublish = async () => {} }) {
    assertImageUrls(imageUrls, 10);
    if (imageUrls.length === 1) {
      await beforePublish(null);
      let photo;
      try {
        photo = await client.request(`${page}/photos`, {
          method: 'POST', body: { url: imageUrls[0], caption, published: 'true' },
        });
      } catch (error) {
        error.uncertain = true;
        throw error;
      }
      const remoteId = photo?.post_id || photo?.id;
      if (!remoteId) throw new MetaApiError('Meta tidak mengembalikan id foto Facebook.', { uncertain: true });
      return { remoteId, containerId: photo?.id || null };
    }
    const attachedMedia = [];
    for (const imageUrl of imageUrls) {
      const photo = await client.request(`${page}/photos`, {
        method: 'POST', body: { url: imageUrl, published: 'false' },
      });
      if (!photo?.id) throw new MetaApiError('Meta tidak mengembalikan id foto untuk carousel Facebook.');
      attachedMedia.push({ media_fbid: photo.id });
    }
    await beforePublish(null);
    let feed;
    try {
      feed = await client.request(`${page}/feed`, {
        method: 'POST',
        body: { message: caption, attached_media: JSON.stringify(attachedMedia) },
      });
    } catch (error) {
      error.uncertain = true;
      throw error;
    }
    if (!feed?.id) throw new MetaApiError('Meta tidak mengembalikan id postingan Facebook.', { uncertain: true });
    return { remoteId: feed.id, containerId: null };
  }

  return { platform: 'facebook', accountId: page, publish };
}

export function createThreadsPublisher({ client, threadsUserId, pollDelay = sleep, maxPolls = 10 }) {
  const account = String(threadsUserId || '').trim();
  if (!account) throw new Error('Threads user ID belum dikonfigurasi.');

  async function publish({ imageUrls, caption = '', beforePublish = async () => {} }) {
    assertImageUrls(imageUrls, 20);
    if (caption.length > 500) throw new Error('Caption Threads maksimal 500 karakter.');
    const single = imageUrls.length === 1;
    let creationId;
    if (single) {
      const container = await client.request(`${account}/threads`, {
        method: 'POST', body: { media_type: 'IMAGE', image_url: imageUrls[0], text: caption },
      });
      if (!container?.id) throw new MetaApiError('Threads tidak mengembalikan container id.');
      creationId = container.id;
    } else {
      const children = [];
      for (const imageUrl of imageUrls) {
        const child = await client.request(`${account}/threads`, {
          method: 'POST', body: { media_type: 'IMAGE', image_url: imageUrl, is_carousel_item: 'true' },
        });
        if (!child?.id) throw new MetaApiError('Threads tidak mengembalikan carousel item id.');
        children.push(child.id);
      }
      const parent = await client.request(`${account}/threads`, {
        method: 'POST', body: { media_type: 'CAROUSEL', children: children.join(','), text: caption },
      });
      if (!parent?.id) throw new MetaApiError('Threads tidak mengembalikan carousel container id.');
      creationId = parent.id;
    }
    await waitForContainer(client, creationId, {
      fields: 'status,error_message', readyValue: 'FINISHED', pendingValues: ['IN_PROGRESS'], pollDelay, maxPolls, label: 'Threads',
    });
    await beforePublish(creationId);
    let published;
    try {
      published = await client.request(`${account}/threads_publish`, {
        method: 'POST', body: { creation_id: creationId },
      });
    } catch (error) {
      error.uncertain = true;
      throw error;
    }
    if (!published?.id) throw new MetaApiError('Threads tidak mengembalikan id postingan.', { uncertain: true });
    return { remoteId: published.id, containerId: creationId };
  }

  return { platform: 'threads', accountId: account, publish };
}

export async function fetchPermalink(client, remoteId, { platform } = {}) {
  if (!remoteId) return null;
  try {
    const field = platform === 'facebook' ? 'permalink_url' : 'permalink';
    const data = await client.request(remoteId, { query: { fields: field } });
    return typeof data?.[field] === 'string' ? data[field] : null;
  } catch {
    return null;
  }
}
