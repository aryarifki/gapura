import { load, loadBuffer } from 'cheerio';
import { isIP } from 'node:net';
import { normalizeHeadline } from '../common/editorial-contract.js';
import { validatePublicSourceUrl } from '../common/sources.js';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 100000;
const BLOCKS = 'p,h2,h3,h4,h5,h6,li,blockquote';
const BLOCK_NAMES = new Set(BLOCKS.split(','));
const SPACED_NAMES = new Set([...BLOCK_NAMES, 'div', 'ul', 'ol', 'section', 'article', 'br']);
const REMOVE = 'nav,header,footer,aside,form,script,style,noscript,template,iframe,button,input,select,textarea';
const NOISE = /(?:^|[\s_-])(?:ad|ads|adslot|advert|advertisement|advertising|adsbygoogle|sponsored|related|recommended|recommendations|social|share|sharing|newsletter|cookie|comments?|byline|reporter|editor|breadcrumb|read-also|baca-juga|article[-_ ]?body[-_ ]?footer)(?:$|[\s_-])/i;
const PAYWALL = /(?:paywall|regwall|subscription-wall|subscribe-wall|premium-wall|content-requires-login|login-required|registration-required)/i;
const LOGIN_TEXT = /(?:subscribe|sign\s*in|log\s*in|register)\s+(?:\w+\s+){0,4}(?:to\s+)?(?:continue\s+reading|read\s+(?:this|the|full|more)|access\s+(?:this|the|full))|(?:masuk|login|berlangganan|daftar)\s+(?:\w+\s+){0,4}(?:membaca\s+(?:artikel\s+)?(?:lengkap|selengkapnya)|melanjutkan\s+membaca)|content\s+requires\s+login/i;
const DENIED_TEXT = /^(?:access denied|403(?: forbidden)?|forbidden|just a moment\.*|attention required!?|verify (?:that )?you are (?:a )?human|checking your browser)/i;
const clean = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/gu, ' ').trim() : '';

function publicUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || /[\\\u0000-\u001f\u007f]/u.test(value)) return null;
  try {
    const parsed = new URL(value.trim(), base);
    if (validatePublicSourceUrl(parsed.href)) return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
    const version = isIP(host);
    if (!version && (!host.includes('.') || !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)))) return null;
    if (!version && /\.(?:lan|home|invalid)$/i.test(host)) return null;
    if (version === 6 && (!/^[23]/.test(host) || host.startsWith('2001:db8:'))) return null;
    if (version === 4) {
      const [a, b, c] = host.split('.').map(Number);
      if ((a === 192 && b === 0 && [0, 2].includes(c)) || (a === 198 && [18, 19].includes(b))
        || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return null;
    }
    parsed.hash = '';
    return parsed.href;
  } catch { return null; }
}

function textOf(element) {
  const parts = [];
  const stack = [element];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === 'string') { parts.push(node); continue; }
    if (hidden(node) || ['script', 'style', 'noscript', 'template'].includes(node.name)) continue;
    if (node.type === 'text') { parts.push(node.data); continue; }
    if (SPACED_NAMES.has(node.name)) { parts.push(' '); stack.push(' '); }
    for (let index = (node.children?.length || 0) - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return parts.join('');
}

function hidden(element) {
  for (let node = element; node; node = node.parent) {
    const attrs = node.attribs || {};
    if ('hidden' in attrs || 'inert' in attrs || attrs['aria-hidden'] === 'true' || node.name === 'template' || node.name === 'noscript'
      || /(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)/i.test(attrs.style || '')) return true;
  }
  return false;
}

function prune($) {
  markStylesheetHidden($);
  $(REMOVE).remove();
  $('*').each((_, element) => {
    if (hidden(element) || NOISE.test(`${element.attribs?.id || ''} ${element.attribs?.class || ''}`)
      || ['navigation', 'complementary', 'contentinfo'].includes(element.attribs?.role)) $(element).remove();
  });
}

function markStylesheetHidden($) {
  // This is conservative static exclusion, not a browser CSS engine. Hidden
  // declarations in conditional rules may exclude extra text rather than
  // accidentally exposing a concealed article body.
  $('style').each((_index, element) => {
    const css = $(element).text().replace(/\/\*[\s\S]*?\*\//gu, '');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if (!/(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/iu.test(rule[2])) continue;
      const selector = rule[1].trim();
      if (!selector || selector.startsWith('@')) continue;
      try { $(selector).attr('hidden', ''); } catch { /* Invalid source CSS never becomes executable code. */ }
    }
  });
}

function plainText(value) {
  return typeof value === 'string' && /<\/?[a-z][^>]*>/i.test(value) ? jsonText(value.replaceAll('&', '&amp;')) : clean(value);
}

function jsonText(value) {
  if (typeof value !== 'string' || !value) return '';
  const $ = load(value, { scriptingEnabled: false }, false);
  prune($);
  return clean(textOf($.root()[0]));
}

function paragraphsIn($, root) {
  const nodes = $(root).is(BLOCKS) ? [root] : $(root).find(BLOCKS).toArray();
  return nodes.filter((element) => {
    for (let parent = element.parent; parent && parent !== root; parent = parent.parent) {
      if (BLOCK_NAMES.has(parent.name)) return false;
    }
    return true;
  }).map((element) => clean(textOf(element)))
    .filter((value) => value && !/^(?:baca(?:\s+juga)?\s*:|pewarta\s*:|reporter\s*:|editor\s*:|copyright\s*[©(]|dilarang keras (?:mengambil|melakukan)|follow\s+us\b)/iu.test(value));
}

function jsonParagraphs(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const $ = load(value, { scriptingEnabled: false }, false);
  prune($);
  const blocks = paragraphsIn($, $.root()[0]);
  return blocks.length ? blocks : textOf($.root()[0]).split(/\r?\n/).map(clean).filter(Boolean);
}

/** Text blocks from explicit feed HTML, excluding hidden/noise markup. No I/O. */
export function extractFeedParagraphs(value) {
  return jsonParagraphs(value);
}

function dateValue(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))?$/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  if (+month < 1 || +month > 12 || +day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate()
    || +hour > 23 || +minute > 59 || +second > 59) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

function matchKey(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^utm_|^(?:fbclid|gclid|msclkid)$/i.test(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.href;
}

function jsonLd($, base) {
  const nodes = [];
  const candidates = [];
  const references = new Map();
  let error = null;
  let count = 0;
  for (const script of $('script[type]').toArray()) {
    if (hidden(script) || script.attribs.type.toLowerCase().split(';')[0].trim() !== 'application/ld+json') continue;
    let value;
    try { value = JSON.parse($(script).text()); } catch { error ||= 'invalid_json_ld'; continue; }
    const stack = [{ value, depth: 0, live: true }];
    while (stack.length) {
      const entry = stack.pop();
      if (++count > 2000 || entry.depth > 32) return { error: 'json_ld_limit', candidates: [], references };
      if (!entry.value || typeof entry.value !== 'object') continue;
      if (Array.isArray(entry.value)) {
        for (const child of entry.value) stack.push({ value: child, depth: entry.depth + 1, live: entry.live });
        continue;
      }
      const node = entry.value;
      nodes.push(node);
      if (typeof node['@id'] === 'string') {
        try {
          const id = new URL(node['@id'], base).href;
          if (Object.keys(node).length > Object.keys(references.get(id) || {}).length) references.set(id, node);
        } catch { /* Invalid IDs cannot resolve references. */ }
      }
      if (entry.live && [node['@type']].flat().some((type) => typeof type === 'string' && /(?:^|[/#])(?:NewsArticle|Article)$/.test(type))) candidates.push(node);
      for (const [key, child] of Object.entries(node)) {
        stack.push({ value: child, depth: entry.depth + 1, live: key === '@graph' || key === 'mainEntity' });
      }
    }
  }
  return { nodes, candidates, references, error };
}

function resolveReference(value, references, base) {
  let node = value;
  const visited = new Set();
  for (let depth = 0; depth < 8 && node && typeof node === 'object' && typeof node['@id'] === 'string'; depth++) {
    let id;
    try { id = new URL(node['@id'], base).href; } catch { break; }
    if (visited.has(id) || !references.has(id)) break;
    visited.add(id);
    node = references.get(id);
  }
  return node;
}

function selectArticle(graph, title, publisher, urls) {
  const keys = urls.map(matchKey);
  const headlineKey = (value) => normalizeHeadline(value, { publisher }).normalize('NFKC').toLocaleLowerCase('id').replace(/[.!?]+$/u, '');
  const pageTitle = headlineKey(title);
  let selected = null;
  let best = 0;
  for (const node of graph.candidates) {
    const page = resolveReference(node.mainEntityOfPage, graph.references, urls[0]);
    const values = [node.url, typeof page === 'string' ? page : page?.url || page?.['@id']];
    if (typeof node['@id'] === 'string' && !node['@id'].startsWith('#')) values.push(node['@id']);
    const identities = values.flat().map((value) => publicUrl(typeof value === 'object' ? value?.['@id'] : value, urls[0])).filter(Boolean);
    const matchedUrl = identities.some((value) => keys.includes(matchKey(value)));
    const headline = headlineKey(jsonText(node.headline || node.name));
    if (identities.length && !matchedUrl) continue;
    if (!matchedUrl && headline && pageTitle && headline !== pageTitle) continue;
    let score = matchedUrl ? 100 : headline && pageTitle && headline === pageTitle ? 50 : 0;
    if (!score && graph.candidates.length === 1 && (!headline || !pageTitle)) score = 1;
    if (!score) continue;
    if (typeof node.articleBody === 'string' && node.articleBody.trim()) score += 5;
    if (score > best) { best = score; selected = node; }
  }
  return selected;
}

function accessStatus($, selected, graph, bases) {
  const paid = (node) => node?.isAccessibleForFree === false || node?.isAccessibleForFree === 'false';
  const page = resolveReference(selected?.mainEntityOfPage, graph.references, bases[0]);
  const baseKeys = bases.map(matchKey);
  const currentPagePaid = graph.nodes.some((node) => paid(node) && [node['@type']].flat().some((type) => /(?:^|[/#])WebPage$/.test(type)) && [node.url || node['@id']]
    .map((value) => typeof value === 'string' ? publicUrl(value, bases[0]) : null).filter(Boolean)
    .some((value) => baseKeys.includes(matchKey(value))));
  if (paid(selected) || paid(page) || [selected?.hasPart].flat().some((part) => paid(resolveReference(part, graph.references, bases[0]))) || currentPagePaid) return 'paywall';
  for (const element of $('title,h1,h2,[id],[class],[role="dialog"],[itemprop~="isAccessibleForFree"]').toArray()) {
    if (hidden(element)) continue;
    const attrs = element.attribs || {};
    const identity = `${attrs.id || ''} ${attrs.class || ''}`;
    if (/cf[-_]challenge|challenge-form|challenge-running|captcha-container/i.test(identity)) return 'access_denied';
    const text = clean(textOf(element));
    if (['title', 'h1'].includes(element.name) && DENIED_TEXT.test(text)) return 'access_denied';
    if (PAYWALL.test(identity) || (attrs.itemprop?.split(/\s+/).includes('isAccessibleForFree') && (attrs.content || text) === 'false')) return 'paywall';
    if (['h1', 'h2'].includes(element.name) || attrs.role === 'dialog') {
      if (LOGIN_TEXT.test(text)) return 'paywall';
    }
  }
  for (const element of $('article p,[itemprop~="articleBody"] p').toArray()) {
    const value = clean(textOf(element));
    if (!hidden(element) && value.length <= 240 && /^(?:log\s*in|sign\s*in|subscribe|register|masuk|login|berlangganan|daftar)\b/i.test(value) && LOGIN_TEXT.test(value)) return 'paywall';
  }
  return null;
}

function imageCandidates($, selected, graph, root, baseUrl, sourceUrl, meta) {
  const images = new Map();
  const dimension = (value) => {
    const number = Number(value && typeof value === 'object' ? value.value : value);
    return Number.isInteger(number) && number > 0 ? number : undefined;
  };
  const append = (value, extra = {}, seen = new Set()) => {
    if (Array.isArray(value)) { for (const entry of value) append(entry, extra, seen); return; }
    if (value && typeof value === 'object') {
      const node = resolveReference(value, graph.references, baseUrl);
      if (seen.has(node)) return;
      seen.add(node);
      append(node.contentUrl || node.url || node['@id'], {
        alt: jsonText(node.caption || node.description || node.name),
        credit: jsonText(node.creditText || node.copyrightNotice),
        width: dimension(node.width), height: dimension(node.height),
      }, seen);
      return;
    }
    if (typeof value !== 'string' || value.trim().startsWith('#')) return;
    const safe = publicUrl(value, baseUrl);
    if (!safe) return;
    const image = images.get(safe) || { url: safe, source_url: sourceUrl, alt: '' };
    for (const field of ['alt', 'credit', 'width', 'height']) if (!image[field] && extra[field]) image[field] = extra[field];
    images.set(safe, image);
  };
  append(selected?.image);
  for (const element of $('meta').toArray()) {
    const property = (element.attribs.property || element.attribs.name || '').toLowerCase();
    if (['og:image', 'og:image:url', 'og:image:secure_url'].includes(property)) append(element.attribs.content, {
      alt: plainText(meta.get('og:image:alt')), width: dimension(meta.get('og:image:width')), height: dimension(meta.get('og:image:height')),
    });
    if (['twitter:image', 'twitter:image:src'].includes(property)) append(element.attribs.content, { alt: plainText(meta.get('twitter:image:alt')) });
  }
  if (root) {
    const scope = $(root).closest('article').first()[0] || root;
    for (const element of $(scope).find('img').toArray()) {
      const attrs = element.attribs;
      const credit = $(element).closest('figure').find('[itemprop~="creditText"],.credit,.photo-credit').first();
      const extra = { alt: clean(attrs.alt), credit: clean(attrs['data-credit']) || clean(credit.text()), width: dimension(attrs.width), height: dimension(attrs.height) };
      for (const attr of ['data-src', 'data-lazy-src', 'data-original', 'src']) append(attrs[attr], extra);
      for (const attr of ['data-srcset', 'srcset']) {
        if (/\b(?:data|javascript):/i.test(attrs[attr] || '')) continue;
        for (const candidate of (attrs[attr] || '').split(',')) append(candidate.trim().split(/\s+/)[0], extra);
      }
    }
  }
  return [...images.values()];
}

/** Resolve only an explicit publisher article anchor, never opaque IDs or a homepage. */
export function resolvePublisherArticleUrl(input, { url, publisherUrl, charset } = {}) {
  const source = publicUrl(url);
  const publisher = publicUrl(publisherUrl);
  if (!source || new URL(source).hostname !== 'news.google.com' || !publisher
    || !(typeof input === 'string' || Buffer.isBuffer(input)) || Buffer.byteLength(input) > MAX_INPUT_BYTES) return null;
  let $;
  try { $ = Buffer.isBuffer(input) ? loadBuffer(input, { encoding: { transportLayerEncodingLabel: charset }, scriptingEnabled: false }) : load(input, { scriptingEnabled: false }); }
  catch { return null; }
  const hostname = new URL(publisher).hostname.replace(/^www\./u, '');
  const candidates = new Set();
  for (const element of $('a[href]').toArray()) {
    if (hidden(element)) continue;
    const candidate = publicUrl(element.attribs.href, source);
    if (!candidate) continue;
    const parsed = new URL(candidate);
    if (parsed.hostname.replace(/^www\./u, '') !== hostname || parsed.port
      || parsed.pathname === '/' || /^\/(?:index|default)\.(?:html?|php|aspx?)$/iu.test(parsed.pathname)) continue;
    candidates.add(candidate);
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

/** Parse an already-fetched document; image URLs are unverified metadata candidates. */
export function extractArticleDocument(input, { url, publisher = '', articleSelectors = [], charset } = {}) {
  const requested = publicUrl(url);
  const result = {
    title: '', publisher: clean(publisher), canonical_url: requested,
    published_at: null, updated_at: null, body: '', paragraphs: [], images: [],
    extraction: { kind: null, status: 'parse_failed', error_code: null },
  };
  const fail = (code, status = 'parse_failed') => {
    result.body = ''; result.paragraphs = []; result.images = [];
    result.extraction = { kind: null, status, error_code: code };
    return result;
  };
  if (!requested) return fail('invalid_url');
  if (!(typeof input === 'string' || Buffer.isBuffer(input)) || !input.length) return fail('invalid_input');
  if ((Buffer.isBuffer(input) ? input.length : Buffer.byteLength(input, 'utf8')) > MAX_INPUT_BYTES) return fail('response_too_large');
  let $;
  try {
    if (charset) new TextDecoder(charset);
    $ = Buffer.isBuffer(input) ? loadBuffer(input, { encoding: { transportLayerEncodingLabel: charset }, scriptingEnabled: false }) : load(input, { scriptingEnabled: false });
  } catch { return fail('invalid_encoding'); }
  markStylesheetHidden($);
  if (textOf($.root()[0]).includes('\ufffd')) return fail('invalid_encoding');
  const meta = new Map();
  $('meta').each((_, element) => {
    const key = (element.attribs.property || element.attribs.name || '').toLowerCase();
    if (!hidden(element) && !meta.has(key)) meta.set(key, element.attribs.content || '');
  });
  result.publisher = plainText(publisher) || plainText(meta.get('og:site_name'));
  const heading = $('article h1,h1').toArray().find((element) => !hidden(element) && !$(element).parents('nav,aside,footer,form').length);
  result.title = normalizeHeadline(plainText(heading ? textOf(heading) : '') || plainText(meta.get('og:title')) || plainText($('title').first().text()), { publisher: result.publisher });
  let diagnostic = null;
  const canonical = $('link[rel]').toArray().find((element) => (element.attribs.rel || '').toLowerCase().split(/\s+/).includes('canonical'));
  if (canonical?.attribs.href) {
    const candidate = publicUrl(canonical.attribs.href, requested);
    if (!candidate) diagnostic = 'canonical_unsafe';
    else if (new URL(candidate).origin !== new URL(requested).origin) diagnostic = 'canonical_cross_origin';
    else if ((new URL(candidate).pathname === '/' || /^\/(?:index|default)\.(?:html?|php|aspx?)$/i.test(new URL(candidate).pathname)) && !new URL(candidate).search
      && (new URL(requested).pathname !== '/' || new URL(requested).search)) diagnostic = 'canonical_homepage';
    else result.canonical_url = candidate;
  }
  const graph = jsonLd($, requested);
  if (graph.error === 'json_ld_limit') return fail(graph.error);
  diagnostic ||= graph.error;
  const selected = selectArticle(graph, result.title, result.publisher, [requested, result.canonical_url]);
  if (selected) {
    const organization = resolveReference(selected.publisher, graph.references, requested);
    result.publisher ||= jsonText(typeof organization === 'string' ? organization : organization?.name);
    result.title = normalizeHeadline(jsonText(selected.headline || selected.name) || result.title, { publisher: result.publisher });
  }
  const blocked = accessStatus($, selected, graph, [requested, result.canonical_url]);
  if (blocked) return fail(blocked, blocked);
  const times = $('time[datetime]').toArray().filter((element) => {
    if (hidden(element) || $(element).parents('nav,aside,header,footer,form').length) return false;
    for (let parent = element.parent; parent; parent = parent.parent) {
      if (NOISE.test(`${parent.attribs?.id || ''} ${parent.attribs?.class || ''}`)) return false;
    }
    return true;
  });
  const modified = (element) => /dateModified|updated|modified/i.test(`${element.attribs.itemprop || ''} ${element.attribs.class || ''} ${element.attribs.id || ''}`);
  result.published_at = [selected?.datePublished, meta.get('article:published_time'), ...times.filter((element) => !modified(element)).map((element) => element.attribs.datetime)].map(dateValue).find(Boolean) || null;
  result.updated_at = [selected?.dateModified, meta.get('article:modified_time'), ...times.filter(modified).map((element) => element.attribs.datetime)].map(dateValue).find(Boolean) || null;
  const summary = selected?.description ? jsonText(selected.description) : plainText(meta.get('og:description') || meta.get('description'));
  prune($);
  let root = null;
  let visible = [];
  for (const selector of ['[itemprop~="articleBody"]', ...(Array.isArray(articleSelectors) ? articleSelectors : []), 'article']) {
    let elements;
    try { elements = $(selector).toArray(); } catch { diagnostic ||= 'invalid_article_selector'; continue; }
    for (const element of elements) {
      if (['html', 'body', 'main'].includes(element.name)) continue;
      const paragraphs = paragraphsIn($, element);
      if (paragraphs.join('\n\n').length > visible.join('\n\n').length) { root = element; visible = paragraphs; }
    }
    if (visible.length) break;
  }
  let paragraphs = jsonParagraphs(selected?.articleBody);
  const kind = paragraphs.length ? 'json_ld' : visible.length ? 'article_html' : null;
  if (!paragraphs.length) paragraphs = visible;
  const body = paragraphs.join('\n\n');
  if (body.length > MAX_TEXT_CHARS) return fail('response_too_large');
  if (!paragraphs.length) return fail(diagnostic || 'no_article_body', summary ? 'summary_only' : 'parse_failed');
  result.body = body;
  result.paragraphs = paragraphs.map((text, index) => ({ id: `p${index + 1}`, text, source_url: result.canonical_url, role: 'reporting' }));
  result.images = imageCandidates($, selected, graph, root, requested, result.canonical_url, meta);
  result.extraction = { kind, status: paragraphs.length >= 3 ? 'full' : 'partial', error_code: diagnostic };
  return result;
}
