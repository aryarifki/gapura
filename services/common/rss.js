// ==============================================================================
// GME v2.1 - Minimal Zero-Dependency RSS / Atom Feed Utilities
// File: /root/gapura/services/common/rss.js
// Dipakai oleh Agen SEO (momentum berita & Google Trends) dan Agen Verifikator
// (uji korroborasi lintas sumber). Sengaja tanpa dependensi eksternal.
// ==============================================================================

import { validatePublicSourceUrl } from './sources.js';

const MAX_FEED_BODY = 100_000;
const unwrapCdata = (value) => String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** Decode satu lapis entitas; code point XML yang tidak valid menjadi replacement character. */
export function decodeEntities(str) {
  if (!str) return '';
  const named = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return unwrapCdata(str).replace(/&(?:#x([0-9a-f]+)|#(\d+)|(nbsp|amp|lt|gt|quot|apos));/gi, (_, hex, dec, name) => {
    if (name) return named[name.toLowerCase()];
    const point = parseInt(hex || dec, hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '\ufffd';
  });
}

function sourceHtml(value) {
  return value.replace(/<!--[^]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi, ' ');
}

function removeIgnoredHtml(value) {
  return sourceHtml(value).replace(/<style\b[^>]*>[\s\S]*?(?:<\/style\s*>|$)/gi, ' ');
}

function plainText(html) {
  return removeIgnoredHtml(html).replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Hilangkan tag HTML & rapikan spasi. */
export function stripHtml(html) {
  return plainText(decodeEntities(html));
}

// fast-xml-parser memakai #text untuk HTML dan object bertingkat untuk XHTML.
function bodyString(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(bodyString).join('');
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).map(([key, node]) => {
    if (key.startsWith('@_')) return '';
    if (key === '#text' || key === '__cdata' || key === '#cdata') return bodyString(node);
    const nodes = Array.isArray(node) ? node : [node];
    return nodes.map((entry) => {
      const attrs = entry && typeof entry === 'object' ? Object.entries(entry)
        .filter(([name]) => name.startsWith('@_'))
        .map(([name, attr]) => ` ${name.slice(2)}="${String(attr).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('') : '';
      return `<${key}${attrs}>${bodyString(entry)}</${key}>`;
    }).join('');
  }).join('');
}

function feedBody(value) {
  const raw = unwrapCdata(bodyString(value));
  if (raw.length > MAX_FEED_BODY) throw new RangeError(`Feed item material exceeds ${MAX_FEED_BODY} characters.`);
  return raw;
}

/** Shared material selection for raw RSS nodes and previously parsed feed items. */
export function feedMaterial(item) {
  if (['rss_full', 'feed_summary'].includes(item.content_kind)) {
    const content = plainText(feedBody(item.content));
    return {
      content, summary: plainText(feedBody(item.summary ?? item.description ?? content)).slice(0, 1000),
      content_kind: item.content_kind, content_html: sourceHtml(feedBody(item.content_html)),
    };
  }
  const explicit = [item['content:encoded'], item.content].map(feedBody).find((raw) => stripHtml(raw));
  const summary = [item.description, item.summary].map(feedBody).find((raw) => stripHtml(raw)) || '';
  const body = explicit || summary;
  return {
    content: stripHtml(body), summary: stripHtml(summary || body).slice(0, 1000),
    content_kind: explicit ? 'rss_full' : 'feed_summary',
    // Source data only: keep CSS for downstream visibility pruning, never render as trusted HTML.
    content_html: explicit ? sourceHtml(explicit).trim() : '',
  };
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/\s([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[`@_${match[1]}`] = match[2] ?? match[3];
  return result;
}

/** Candidate discovery only. Scout still applies its own image host allowlist. */
export function feedImageCandidates(item, baseUrl = '') {
  const candidates = [];
  const append = (value) => {
    if (Array.isArray(value)) { value.forEach(append); return; }
    if (typeof value === 'string') { candidates.push(value); return; }
    if (!value || typeof value !== 'object') return;
    const type = value['@_type'] || value.type;
    const medium = value['@_medium'] || value.medium;
    if ((type && !String(type).startsWith('image/')) || (medium && medium !== 'image')) return;
    candidates.push(value['@_url'], value.url, value['@_href'], value['#text']);
  };
  append(item['media:content']);
  append(item['media:thumbnail']);
  append(item.enclosure);
  for (const group of [item['media:group']].flat()) {
    append(group?.['media:content']);
    append(group?.['media:thumbnail']);
  }
  append(item.images);
  append(item.image_url);
  for (const value of [item['content:encoded'], item.content_html, item.content, item.description, item.summary]) {
    const raw = removeIgnoredHtml(unwrapCdata(bodyString(value)));
    for (const match of raw.matchAll(/<img\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      append(attrs['@_src'] || attrs['@_data-src']);
    }
  }
  append(item.image);
  return [...new Set(candidates.flatMap((candidate) => {
    if (typeof candidate !== 'string' || /[\u0000-\u001f\u007f]/.test(candidate)) return [];
    try {
      const url = new URL(decodeEntities(candidate), baseUrl || undefined);
      return validatePublicSourceUrl(url.toString()) ? [] : [url.toString()];
    } catch { return []; }
  }))];
}

function pickTag(block, tags, requireText = true) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
    const m = block.match(re);
    if (m && m[1] && (!requireText || stripHtml(m[1]))) return m[1];
  }
  return '';
}

function pickAttr(block, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}=["']([^"']+)["'][^>]*/?>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

/**
 * Parser RSS 2.0 / Atom / Google Trends RSS tanpa dependensi.
 * @param {string} xmlText
 * @param {{isolateErrors?:boolean}} options Keep invalid entries and per-item errors in their original slots for ingestion diagnostics.
 * @returns {Array<{error:Error}|{title:string, raw_title:string, link:string, description:string, content:string, content_html:string, content_kind:'rss_full'|'feed_summary', pubDate:string|null, updated_at:string|null, author:string, guid:string, images:string[], image_url:string|null, extra:object}>}
 */
export function parseFeed(xmlText, { isolateErrors = false } = {}) {
  if (!xmlText || typeof xmlText !== 'string') return [];

  const blocks = [];
  const blockRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(xmlText)) !== null) {
    blocks.push(match[0]);
  }
  // Fallback: sebagian feed memakai <item ... /> self-closing (jarang) — diabaikan.

  return blocks
    .map((block) => {
      try {
        const sourceBlock = pickTag(block, ['source']);
        const metadata = block.replace(/<(source|content:encoded|content|description|summary)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
        const rawTitle = unwrapCdata(pickTag(metadata, ['title']));
        const title = stripHtml(rawTitle);
        const links = [...metadata.matchAll(/<link\b[^>]*>/gi)].map((entry) => attributes(entry[0]));
        const alternate = links.find((entry) => entry['@_rel'] === 'alternate' && entry['@_href'])
          || links.find((entry) => !entry['@_rel'] && entry['@_href']);
        const guid = stripHtml(pickTag(metadata, ['guid', 'id']));
        const link = stripHtml(pickTag(metadata, ['link'])) || decodeEntities(alternate?.['@_href']) || guid;
        const atomHtml = (tag) => {
          const raw = pickTag(block, [tag], false);
          return pickAttr(block, tag, 'type') === 'html' && !raw.includes('<![CDATA[') ? decodeEntities(raw) : raw;
        };
        const description = pickTag(block, ['description'], false);
        const summary = atomHtml('summary');
        const material = feedMaterial({
          'content:encoded': pickTag(block, ['content:encoded'], false), content: atomHtml('content'),
          description, summary,
        });
        const pubDate = stripHtml(pickTag(metadata, ['pubDate', 'published', 'dc:date'])) || null;
        const updated_at = stripHtml(pickTag(metadata, ['updated', 'modified', 'dc:modified'])) || null;
        const authorBlock = pickTag(metadata, ['author', 'dc:creator']);
        const author = stripHtml(pickTag(authorBlock, ['name']) || authorBlock);

        // Google Trends RSS menyertakan <ht:approx_traffic> dan <ht:news_item>
        const approxTraffic = stripHtml(pickTag(block, ['ht:approx_traffic']));
        // Google News menyertakan <source url="https://...">Nama Media</source>
        const sourceName = stripHtml(pickTag(sourceBlock, ['title']) || sourceBlock);
        const sourceUrl = decodeEntities(pickAttr(block, 'source', 'url') || pickAttr(sourceBlock, 'link', 'href'));
        const imageNodes = {};
        for (const tag of ['media:content', 'media:thumbnail', 'enclosure']) {
          imageNodes[tag] = [...block.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))].map((entry) => attributes(entry[0]));
        }
        const images = feedImageCandidates({ ...imageNodes, content_html: material.content_html, description, summary }, link);
        const newsItems = [];
        const newsRe = /<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi;
        let nm;
        while ((nm = newsRe.exec(block)) !== null) {
          const nb = nm[1];
          newsItems.push({
            title: stripHtml(pickTag(nb, ['ht:news_item_title'])),
            url: stripHtml(pickTag(nb, ['ht:news_item_url'])),
            source: stripHtml(pickTag(nb, ['ht:news_item_source'])),
          });
        }

        return {
          title,
          raw_title: rawTitle,
          link,
          description: material.summary,
          content: material.content,
          content_html: material.content_html,
          content_kind: material.content_kind,
          pubDate,
          updated_at,
          author: author.replace(/^.*\((.*)\)$/, '$1') || author,
          guid,
          images,
          image_url: images[0] || null,
          extra: { approxTraffic, newsItems, sourceName, sourceUrl },
        };
      } catch (error) {
        if (!isolateErrors) throw error;
        return { error };
      }
    })
    .filter((it) => isolateErrors || (it.title && (it.link || it.title.length > 8)));
}

/** Ambil feed dengan User-Agent wajar & timeout. Mengembalikan { ok, items, error, status }. */
export async function fetchFeed(url, { timeoutMs = 15000, accept = 'application/rss+xml, application/xml, text/xml, application/atom+xml, text/html', fetchImpl = fetch, isolateErrors = false } = {}) {
  try {
    const res = await fetchImpl(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GapuraMediaBot/2.1; +https://gapura.avenia.my.id)',
        Accept: accept,
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}`, status: res.status };
    const text = await res.text();
    return { ok: true, items: parseFeed(text, { isolateErrors }), error: null, status: res.status };
  } catch (err) {
    return { ok: false, items: [], error: err.message, status: 0 };
  }
}

/** Bangun URL Google News RSS Search (keyless, andal). */
export function googleNewsRssUrl(query, { when = '1d', hl = 'id', gl = 'ID', ceid = 'ID:id' } = {}) {
  const q = when ? `${query} when:${when}` : query;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/** Ambil domain dari sebuah URL (untuk uji korroborasi lintas sumber). */
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
