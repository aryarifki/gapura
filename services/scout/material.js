import { extractFeedParagraphs } from './article.js';
import { normalizeHeadline } from '../common/editorial-contract.js';
import { validatePublicSourceUrl } from '../common/sources.js';
import { safeDate } from './sources.js';

const MAX_BODY = 100000;
function date(value) {
  return safeDate(value)?.toISOString() || null;
}
const text = (value) => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
const url = (value) => typeof value === 'string' && !validatePublicSourceUrl(value) ? new URL(value).toString() : null;

function paragraphsFrom(content, html, sourceUrl) {
  const blocks = html.trim() ? extractFeedParagraphs(html)
    : String(content || '').split(/\n+|(?<=[.!?])\s+(?=[\p{L}“"])/u).map(text).filter(Boolean);
  return [...new Set(blocks)].map((value, index) => ({ id: `p${index + 1}`, text: value, source_url: sourceUrl, role: 'reporting' }));
}

export function createMaterial(item = {}, { document = null, retrievedAt = new Date().toISOString() } = {}) {
  const discoveryUrl = url(item.url || item.link);
  if (!discoveryUrl) throw new Error('material_discovery_url_invalid');
  const publisher = text(document?.publisher || item.source || item.publisher || item.author);
  const rawTitle = text(item.raw_title || item.title);
  const isAggregator = new URL(discoveryUrl).hostname === 'news.google.com' || item.type === 'google_news_proxy' || item.provider === 'google_trends';
  const resolvedArticle = url(document?.canonical_url);
  const articleUrl = resolvedArticle && new URL(resolvedArticle).hostname !== 'news.google.com'
    ? resolvedArticle : isAggregator ? null : discoveryUrl;
  const sourceUrl = articleUrl || discoveryUrl;
  const html = typeof item.content_html === 'string' ? item.content_html : '';
  let body = document ? String(document.body || '') : typeof item.content === 'string' ? item.content.trim() : text(item.description || item.summary);
  if (body.length > MAX_BODY || html.length > 2 * 1024 * 1024) throw new Error('material_body_too_large');
  const kind = ['rss_full', 'x_post'].includes(item.content_kind) ? item.content_kind : 'feed_summary';
  const paragraphs = document ? structuredClone(document.paragraphs || []) : paragraphsFrom(body, html, sourceUrl);
  if (!document && html.trim()) body = paragraphs.map((paragraph) => paragraph.text).join('\n\n');
  const candidates = Array.isArray(item.images) ? structuredClone(item.images).map((candidate) => typeof candidate === 'string' ? { url: candidate, source_url: sourceUrl } : candidate) : [];
  if (url(item.image_url) && !candidates.some((candidate) => candidate.url === item.image_url)) candidates.push({ url: item.image_url, source_url: sourceUrl });
  const extraction = document ? structuredClone(document.extraction) : { kind, status: kind === 'feed_summary' ? 'summary_only' : body && paragraphs.length >= 3 ? 'full' : 'partial', error_code: body ? null : 'source_body_missing' };
  return {
    version: 1,
    raw_title: rawTitle,
    headline: normalizeHeadline(text(document?.title) || text(item.title), { publisher }),
    provider: text(item.type || item.provider) || 'rss',
    publisher,
    discovery_url: discoveryUrl,
    article_url: articleUrl,
    published_at: date(document?.published_at) || date(item.published_at || item.pubDate),
    updated_at: date(document?.updated_at) || date(item.updated_at),
    retrieved_at: date(retrievedAt) || new Date().toISOString(),
    discovery_summary: text(item.summary || item.description || item.content).slice(0, 1000),
    body,
    paragraphs,
    images: document ? structuredClone(document.images || []) : candidates.filter((candidate) => url(candidate?.url)).map((candidate) => ({ ...candidate, source_url: url(candidate.source_url) || sourceUrl })),
    extraction,
  };
}
