// ==============================================================================
// GME v2.1 - Minimal Zero-Dependency RSS / Atom Feed Utilities
// File: /root/gapura/services/common/rss.js
// Dipakai oleh Agen SEO (momentum berita & Google Trends) dan Agen Verifikator
// (uji korroborasi lintas sumber). Sengaja tanpa dependensi eksternal.
// ==============================================================================

/** Decode entitas XML/HTML yang umum muncul di feed. */
export function decodeEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/** Hilangkan tag HTML & rapikan spasi. */
export function stripHtml(html) {
  return decodeEntities(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickTag(block, tags) {
  for (const tag of tags) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
    const m = block.match(re);
    if (m && m[1] && stripHtml(m[1])) return m[1];
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
 * @returns {Array<{title:string, link:string, description:string, pubDate:string|null, author:string, guid:string, extra:object}>}
 */
export function parseFeed(xmlText) {
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
      const title = stripHtml(pickTag(block, ['title']));
      let link = stripHtml(pickTag(block, ['link']));
      if (!link) link = pickAttr(block, 'link', 'href');
      const description = stripHtml(pickTag(block, ['description', 'summary', 'content', 'content:encoded']));
      const pubDate = stripHtml(pickTag(block, ['pubDate', 'published', 'updated', 'dc:date'])) || null;
      const author = stripHtml(pickTag(block, ['author', 'dc:creator']));
      const guid = stripHtml(pickTag(block, ['guid', 'id']));

      // Google Trends RSS menyertakan <ht:approx_traffic> dan <ht:news_item>
      const approxTraffic = stripHtml(pickTag(block, ['ht:approx_traffic']));
      // Google News menyertakan <source url="https://...">Nama Media</source>
      const sourceName = stripHtml(pickTag(block, ['source']));
      const sourceUrl = pickAttr(block, 'source', 'url');
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
        link: link || guid,
        description,
        pubDate,
        author: stripHtml(author).replace(/^.*\((.*)\)$/, '$1') || author,
        guid,
        extra: { approxTraffic, newsItems, sourceName, sourceUrl },
      };
    })
    .filter((it) => it.title && (it.link || it.title.length > 8));
}

/** Ambil feed dengan User-Agent wajar & timeout. Mengembalikan { ok, items, error, status }. */
export async function fetchFeed(url, { timeoutMs = 15000, accept = 'application/rss+xml, application/xml, text/xml, application/atom+xml, text/html' } = {}) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GapuraMediaBot/2.1; +https://gapura.avenia.my.id)',
        Accept: accept,
        'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}`, status: res.status };
    const text = await res.text();
    return { ok: true, items: parseFeed(text), error: null, status: res.status };
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
