import { fetchFeed as fetchFeedUnchecked, googleNewsRssUrl, domainOf, feedImageCandidates, feedMaterial, stripHtml } from '../common/rss.js';
import { validatePublicSourceUrl } from '../common/sources.js';
import { normalizeHeadline } from '../common/editorial-contract.js';

const X_API = 'https://api.twitter.com/2';
const IMAGE_HOSTS = new Set(['pbs.twimg.com', 'images.unsplash.com', 'img.antaranews.com', 'cdn.antaranews.com', 'foto.kontan.co.id', 's.kontan.co.id', 'assets.cnbcindonesia.com', 'images.cnbcindonesia.com', 'img.bisnis.com', 'asset.kompas.com', 'images.kompas.com', 'awsimages.detik.net.id', 'akcdn.detik.net.id', 'static.republika.co.id']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export async function fetchSourceFeed(url, { fetchImpl = fetch, ...options } = {}) {
  return fetchFeedUnchecked(url, {
    ...options,
    fetchImpl: async (...args) => {
      const response = await fetchImpl(...args);
      if (!response.ok) return response;
      const xml = await response.text();
      if (!/<(?:rss|feed)\b/i.test(xml) || !/<\/(?:rss|feed)>/i.test(xml)) throw new Error('Respons bukan RSS/Atom feed.');
      return { ok: true, status: response.status, text: async () => xml };
    },
  });
}

export function normalizeArticleUrl(value) {
  if (typeof value !== 'string' || CONTROL_CHARS.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (validatePublicSourceUrl(url.toString())) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export function safeDate(value) {
  if (value instanceof Date || typeof value === 'number') return Number.isFinite(new Date(value).getTime()) ? new Date(value) : null;
  if (typeof value !== 'string') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/iu.exec(value.trim());
  const rfc = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s+(?:GMT|UTC|[+-](?:[01]\d|2[0-3])[0-5]\d)$/iu.exec(value.trim());
  if (!iso && !rfc) return null;
  const year = Number(iso ? iso[1] : rfc[3]);
  const month = iso ? Number(iso[2]) : ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(rfc[2].toLowerCase()) + 1;
  const day = Number(iso ? iso[3] : rfc[1]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function text(value) {
  const raw = value && typeof value === 'object' ? value['#text'] : value;
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
}

export function cleanText(value) {
  return stripHtml(text(value));
}

export function normalizeFeedItem(item) {
  if (!item || typeof item !== 'object') return null;
  const links = Array.isArray(item.link) ? item.link : [item.link];
  const articleLink = links.find((link) => link?.['@_rel'] === 'alternate')
    || links.find((link) => typeof link === 'string' || (link && !link['@_rel']));
  const url = normalizeArticleUrl(text(articleLink) || articleLink?.['@_href'] || text(item.guid) || text(item.id));
  const source = cleanText(item.source?.title) || cleanText(item.source) || cleanText(item.extra?.sourceName);
  const rawTitle = typeof item.raw_title === 'string' ? item.raw_title : text(item.title);
  const title = normalizeHeadline(cleanText(rawTitle), { publisher: source });
  if (!url || !title) return null;
  const material = feedMaterial(item);
  const images = feedImageCandidates(item, url);
  const publisherLink = [item.source?.link].flat().find((link) => link?.['@_rel'] === 'alternate')
    || [item.source?.link].flat().find((link) => typeof link === 'string' || (link && !link['@_rel']));
  return {
    title, raw_title: rawTitle, url,
    ...material,
    published_at: safeDate(text(item.pubDate || item.published || item['dc:date'])),
    updated_at: safeDate(text(item.updated_at || item.updated || item.modified || item['dc:modified'])),
    source,
    publisher_url: normalizeArticleUrl(item.source?.['@_url'] || publisherLink?.['@_href'] || text(publisherLink) || item.extra?.sourceUrl),
    image_url: images.find((image) => trustedImageUrl(image)) || null,
    images,
    type: 'rss',
  };
}

function trustedImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (validatePublicSourceUrl(url.toString()) || !IMAGE_HOSTS.has(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function xHandleFromSource(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^@?([A-Za-z0-9_]{1,15})$/) || raw.match(/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/?$/i);
  return match ? match[1] : null;
}

export function validateSourceType(type, value) {
  if (type === 'x_account') return xHandleFromSource(value) ? null : 'Akun X harus berupa @handle atau URL profil x.com.';
  if (type === 'x_query') {
    const query = String(value || '').trim();
    return query.length >= 2 && query.length <= 250 && !CONTROL_CHARS.test(query)
      ? null : 'Query X harus memiliki panjang 2-250 karakter.';
  }
  if (type === 'rss') {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'https:' ? null : 'Feed RSS harus menggunakan HTTPS.';
    } catch { return 'URL feed RSS tidak valid.'; }
  }
  return 'Tipe sumber tidak didukung. Pilih RSS/Atom, akun X, atau pencarian X.';
}

export function extractImageUrl(item) {
  if (!item || typeof item !== 'object') return null;
  return feedImageCandidates(item, item.url || text(item.link)).find((image) => trustedImageUrl(image)) || null;
}

export function normalizeXPosts(payload, handle) {
  if (!Array.isArray(payload?.data)) return [];
  const media = new Map((Array.isArray(payload.includes?.media) ? payload.includes.media : []).map((item) => [item.media_key, item]));
  return payload.data.flatMap((post) => {
    if (!post || typeof post !== 'object') return [];
    const content = String(post.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!post.id || !content) return [];
    const attached = post.attachments?.media_keys || [];
    const images = [...new Set(attached.map((key) => trustedImageUrl(media.get(key)?.url || media.get(key)?.preview_image_url)).filter(Boolean))];
    const published = safeDate(post.created_at)?.toISOString() || null;
    return [{
      title: normalizeHeadline(content.slice(0, 280)), raw_title: content.slice(0, 280), content,
      summary: content.slice(0, 1000), content_kind: 'x_post', content_html: '',
      url: `https://x.com/${handle}/status/${post.id}`,
      published_at: published,
      updated_at: null,
      image_url: images[0] || null,
      images,
      type: 'x_api',
      ...(post.public_metrics && typeof post.public_metrics === 'object' ? { metrics: post.public_metrics } : {}),
      source: `@${handle}`,
    }];
  });
}

function normalizeProxyFeed(items, type, fallbackSource = '', isolateErrors = false) {
  return items.flatMap((item) => {
    if (item?.error) return [item];
    try {
      const normalized = normalizeFeedItem(item);
      if (!normalized) return isolateErrors ? [{ error: new Error('Feed item URL/title tidak valid; artikel harus HTTPS.') }] : [];
      return [{
        ...normalized, type,
        source: normalized.source || item.author || fallbackSource || domainOf(normalized.publisher_url || normalized.url),
      }];
    } catch (error) {
      if (!isolateErrors) throw error;
      return [{ error }];
    }
  });
}

export async function fetchXAccount(source, { token = process.env.X_BEARER_TOKEN || '', rssHubBase = process.env.RSSHUB_BASE_URL || '', fetchImpl = fetch, timeoutMs = 12000, isolateErrors = false } = {}) {
  const handle = xHandleFromSource(source);
  if (!handle) throw new Error('Sumber X harus berupa @handle atau URL profil x.com.');
  if (!token) {
    const fallbackBase = String(rssHubBase).replace(/\/+$/, '');
    if (fallbackBase) {
      const feed = await fetchSourceFeed(`${fallbackBase}/twitter/user/${encodeURIComponent(handle)}`, { fetchImpl, timeoutMs, isolateErrors });
      if (feed.ok) return normalizeProxyFeed(feed.items, 'rsshub', `@${handle}`, isolateErrors);
    }
    const feed = await fetchSourceFeed(googleNewsRssUrl(`site:x.com/${handle}`, { when: '1d' }), { fetchImpl, timeoutMs, isolateErrors });
    if (feed.ok) return normalizeProxyFeed(feed.items, 'google_news_proxy', '', isolateErrors);
    throw new Error('X_BEARER_TOKEN belum dikonfigurasi dan fallback RSSHub/Google News gagal.');
  }
  const request = async (url) => {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`X API HTTP ${response.status}`);
    return response.json();
  };
  try {
    const user = await request(`${X_API}/users/by/username/${encodeURIComponent(handle)}?user.fields=id`);
    if (!user.data?.id) throw new Error(`Akun X @${handle} tidak ditemukan.`);
    const timeline = await request(`${X_API}/users/${encodeURIComponent(user.data.id)}/tweets?max_results=10&exclude=retweets,replies&tweet.fields=created_at,public_metrics,attachments&expansions=attachments.media_keys&media.fields=url,preview_image_url`);
    return normalizeXPosts(timeline, handle);
  } catch (error) {
    try { return await fetchXAccount(source, { token: '', rssHubBase, fetchImpl, timeoutMs, isolateErrors }); }
    catch (fallbackError) { throw new Error(`${error.message}; ${fallbackError.message}`); }
  }
}

export async function fetchXQuery(query, { token = process.env.X_BEARER_TOKEN || '', rssHubBase = process.env.RSSHUB_BASE_URL || '', fetchImpl = fetch, timeoutMs = 12000, isolateErrors = false } = {}) {
  const search = String(query || '').trim();
  if (search.length < 2 || search.length > 250 || CONTROL_CHARS.test(search)) throw new Error('Query X tidak valid (2-250 karakter).');
  if (!token) {
    const fallbackBase = String(rssHubBase).replace(/\/+$/, '');
    if (fallbackBase) {
      const rss = await fetchSourceFeed(`${fallbackBase}/twitter/keyword/${encodeURIComponent(search)}`, { fetchImpl, timeoutMs, isolateErrors });
      if (rss.ok) return normalizeProxyFeed(rss.items, 'rsshub', 'X', isolateErrors);
    }
    const fallback = await fetchSourceFeed(googleNewsRssUrl(search, { when: '1d' }), { fetchImpl, timeoutMs, isolateErrors });
    if (!fallback.ok) throw new Error('X_BEARER_TOKEN belum dikonfigurasi dan fallback Google News gagal.');
    return normalizeProxyFeed(fallback.items, 'google_news_proxy', '', isolateErrors);
  }
  const url = `${X_API}/tweets/search/recent?query=${encodeURIComponent(`${search} lang:id -is:retweet`)}&max_results=50&tweet.fields=created_at,public_metrics,attachments&expansions=author_id,attachments.media_keys&user.fields=username,name&media.fields=url,preview_image_url`;
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`X API HTTP ${response.status}`);
    const payload = await response.json();
    const users = new Map((payload.includes?.users || []).map((user) => [user.id, user.username]));
    return (Array.isArray(payload.data) ? payload.data : []).flatMap((tweet) => {
      const handle = xHandleFromSource(users.get(tweet?.author_id)) || 'i';
      return normalizeXPosts({ data: [tweet], includes: payload.includes }, handle);
    });
  } catch (error) {
    try { return await fetchXQuery(search, { token: '', rssHubBase, fetchImpl, timeoutMs, isolateErrors }); }
    catch (fallbackError) { throw new Error(`${error.message}; ${fallbackError.message}`); }
  }
}
