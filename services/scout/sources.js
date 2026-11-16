import { fetchFeed as fetchFeedUnchecked, googleNewsRssUrl, domainOf } from '../common/rss.js';
import { validatePublicSourceUrl } from '../common/sources.js';

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
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const publicUrl = new URL(url);
    publicUrl.protocol = 'https:';
    if (validatePublicSourceUrl(publicUrl.toString())) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch { return null; }
}

export function safeDate(value) {
  if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date) || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function text(value) {
  const raw = value && typeof value === 'object' ? value['#text'] : value;
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
}

export function cleanText(value) {
  return text(value).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeFeedItem(item) {
  if (!item || typeof item !== 'object') return null;
  const links = Array.isArray(item.link) ? item.link : [item.link];
  const articleLink = links.find((link) => link?.['@_rel'] === 'alternate')
    || links.find((link) => typeof link === 'string' || (link && !link['@_rel']));
  const url = normalizeArticleUrl(text(articleLink) || articleLink?.['@_href'] || text(item.guid));
  const title = cleanText(item.title);
  if (!url || !title) return null;
  return {
    title, url,
    content: cleanText(item.description || item.summary || item.content || item['content:encoded']).slice(0, 1000),
    published_at: safeDate(text(item.pubDate || item.published || item.updated || item['dc:date'])),
    source: cleanText(item.source),
    publisher_url: normalizeArticleUrl(item.source?.['@_url']),
    image_url: extractImageUrl(item),
    type: 'rss',
  };
}

function trustedImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) return null;
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
  const candidates = [];
  const append = (value) => {
    if (typeof value === 'string') candidates.push(value);
    else if (value && typeof value === 'object') {
      if (value['@_type'] && !String(value['@_type']).startsWith('image/')) return;
      if (Array.isArray(value)) { value.forEach(append); return; }
      candidates.push(value['@_url'], value.url, value['@_href']);
    }
  };
  append(item['media:content']);
  append(item['media:thumbnail']);
  append(item.enclosure);
  append(item['media:group']?.['media:content']);
  if (typeof item.description === 'string' || typeof item['content:encoded'] === 'string') {
    const html = String(item.description || item['content:encoded']);
    const match = html.match(/<img\b[^>]*\bsrc=["'](https:\/\/[^"']+)["']/i);
    if (match) candidates.push(match[1]);
  }
  append(item.image);
  for (const value of candidates) {
    const safe = trustedImageUrl(value);
    if (safe) return safe;
  }
  return null;
}

export function normalizeXPosts(payload, handle) {
  if (!Array.isArray(payload?.data)) return [];
  const media = new Map((Array.isArray(payload.includes?.media) ? payload.includes.media : []).map((item) => [item.media_key, item]));
  return payload.data.flatMap((post) => {
    if (!post || typeof post !== 'object') return [];
    const text = String(post.text || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (!post.id || !text) return [];
    const attached = post.attachments?.media_keys || [];
    const imageUrl = attached.map((key) => trustedImageUrl(media.get(key)?.url)).find(Boolean) || null;
    const published = post.created_at && !Number.isNaN(Date.parse(post.created_at))
      ? new Date(post.created_at).toISOString() : null;
    return [{
      title: text.slice(0, 280), content: text.slice(0, 4000),
      url: `https://x.com/${handle}/status/${post.id}`,
      published_at: published,
      image_url: imageUrl,
      type: 'x_api',
      ...(post.public_metrics && typeof post.public_metrics === 'object' ? { metrics: post.public_metrics } : {}),
      source: `@${handle}`,
    }];
  });
}

export async function fetchXAccount(source, { token = process.env.X_BEARER_TOKEN || '', rssHubBase = process.env.RSSHUB_BASE_URL || '', fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const handle = xHandleFromSource(source);
  if (!handle) throw new Error('Sumber X harus berupa @handle atau URL profil x.com.');
  if (!token) {
    const fallbackBase = String(rssHubBase).replace(/\/+$/, '');
    if (fallbackBase) {
      const feed = await fetchSourceFeed(`${fallbackBase}/twitter/user/${encodeURIComponent(handle)}`, { fetchImpl, timeoutMs });
      if (feed.ok) return feed.items.map((item) => ({
        title: `[X/RSSHub] ${item.title || item.description}`,
        content: item.description || item.title || '',
        url: item.link,
        published_at: item.pubDate || null,
        image_url: null,
        type: 'rsshub',
        source: `@${handle} (RSSHub)`,
      }));
    }
    const feed = await fetchSourceFeed(googleNewsRssUrl(`site:x.com/${handle}`, { when: '1d' }), { fetchImpl, timeoutMs });
    if (feed.ok) return feed.items.map((item) => ({
      title: `[Google News: X fallback] ${item.title}`,
      content: item.description || '',
      url: item.link,
      publisher_url: normalizeArticleUrl(item.extra?.sourceUrl),
      published_at: item.pubDate || null,
      image_url: null,
      type: 'google_news_proxy',
      source: item.extra?.sourceName || domainOf(item.extra?.sourceUrl || item.link),
    }));
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
    return normalizeXPosts(timeline, handle).map((post) => ({ ...post, title: `[X] ${post.title}` }));
  } catch (error) {
    try { return await fetchXAccount(source, { token: '', rssHubBase, fetchImpl, timeoutMs }); }
    catch (fallbackError) { throw new Error(`${error.message}; ${fallbackError.message}`); }
  }
}

export async function fetchXQuery(query, { token = process.env.X_BEARER_TOKEN || '', rssHubBase = process.env.RSSHUB_BASE_URL || '', fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const search = String(query || '').trim();
  if (search.length < 2 || search.length > 250 || CONTROL_CHARS.test(search)) throw new Error('Query X tidak valid (2-250 karakter).');
  if (!token) {
    const fallbackBase = String(rssHubBase).replace(/\/+$/, '');
    if (fallbackBase) {
      const rss = await fetchSourceFeed(`${fallbackBase}/twitter/keyword/${encodeURIComponent(search)}`, { fetchImpl, timeoutMs });
      if (rss.ok) return rss.items.map((item) => ({
        title: `[X/RSSHub] ${item.title || item.description}`, content: item.description || '',
        url: item.link, published_at: item.pubDate || null, image_url: null, type: 'rsshub',
        source: item.author || 'X (RSSHub)',
      }));
    }
    const fallback = await fetchSourceFeed(googleNewsRssUrl(search, { when: '1d' }), { fetchImpl, timeoutMs });
    if (!fallback.ok) throw new Error('X_BEARER_TOKEN belum dikonfigurasi dan fallback Google News gagal.');
    return fallback.items.map((item) => ({
      title: `[Google News: X query fallback] ${item.title}`,
      content: item.description || '',
      url: item.link,
      publisher_url: normalizeArticleUrl(item.extra?.sourceUrl),
      published_at: item.pubDate || null,
      image_url: null,
      type: 'google_news_proxy',
      source: item.extra?.sourceName || domainOf(item.extra?.sourceUrl || item.link),
    }));
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
      return normalizeXPosts({ data: [tweet], includes: payload.includes }, handle)
        .map((post) => ({ ...post, title: `[X] ${post.title}` }));
    });
  } catch (error) {
    try { return await fetchXQuery(search, { token: '', rssHubBase, fetchImpl, timeoutMs }); }
    catch (fallbackError) { throw new Error(`${error.message}; ${fallbackError.message}`); }
  }
}
