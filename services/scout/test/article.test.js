import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractArticleDocument } from '../article.js';

const url = 'https://news.example/politik/peraturan';
const fixture = (name) => readFileSync(new URL(`./fixtures/articles/${name}.html`, import.meta.url), 'utf8');
const extract = (html, options = {}) => extractArticleDocument(html, { url, ...options });
const htmlArticle = (content, head = '') => `<html><head><title>Informasi layanan</title>${head}</head><body><article><h1>Informasi layanan</h1>${content}</article></body></html>`;

test('extracts only article paragraphs, headings and lists with stable source references', () => {
  const result = extract(fixture('article'), { url: `${url}?from=rss`, publisher: 'Kabar Publik' });
  assert.equal(result.title, 'Peraturan baru & dampaknya');
  assert.equal(result.publisher, 'Kabar Publik');
  assert.equal(result.canonical_url, url);
  assert.deepEqual(result.extraction, { kind: 'article_html', status: 'full', error_code: null });
  assert.equal(result.paragraphs.length, 5);
  assert.equal(result.paragraphs[1].text, 'Rincian & pelaksanaan');
  assert.equal(result.paragraphs[4].text, 'Dokumen diperiksa oleh petugas.');
  assert.equal(result.body, result.paragraphs.map((paragraph) => paragraph.text).join('\n\n'));
  assert.ok(result.paragraphs.every((paragraph, index) => paragraph.id === `p${index + 1}` && paragraph.source_url === url && paragraph.role === 'reporting'));
  assert.doesNotMatch(result.body, /NAVIGASI|BYLINE|IKLAN|BERITA LAIN|PROMOSI|BAGIKAN|TERSEMBUNYI|NOSCRIPT|FOOTER|LOGIN FORM|color: red|__articleParserExecuted/);
  assert.equal(globalThis.__articleParserExecuted, undefined);
  assert.deepEqual(extract(fixture('article'), { url: `${url}?from=rss`, publisher: 'Kabar Publik' }), result);
});

test('resolves relative article images and keeps explicit metadata without asserting reuse rights', () => {
  const result = extract(fixture('article'));
  assert.deepEqual(result.images, [{ url: 'https://news.example/foto/rapat.jpg', source_url: url, alt: 'Rapat & sidang', credit: 'Foto: Redaksi', width: 1200, height: 800 }]);
  assert.equal(result.images[0].rights_basis, undefined);
});

test('prefers the matching NewsArticle in a JSON-LD graph and resolves referenced images and publisher', () => {
  const result = extract(fixture('graph'));
  assert.deepEqual(result.extraction, { kind: 'json_ld', status: 'full', error_code: null });
  assert.equal(result.title, 'Peraturan baru & dampaknya');
  assert.equal(result.publisher, 'Kabar Publik');
  assert.equal(result.paragraphs.length, 3);
  assert.match(result.body, /peraturan baru & pedoman/);
  assert.doesNotMatch(result.body, /SALAH|Teaser/);
  assert.deepEqual(result.images, [{ url: 'https://news.example/foto/grafik.jpg', source_url: url, alt: 'Grafik & data layanan', credit: 'Dokumentasi Redaksi', width: 1200, height: 800 }]);
});

test('rejects unrelated JSON-LD articles and falls back to the visible article', () => {
  const result = extract(fixture('related-only'));
  assert.equal(result.extraction.kind, 'article_html');
  assert.equal(result.extraction.status, 'full');
  assert.doesNotMatch(result.body, /SALAH/);
  const unrelatedOnly = fixture('related-only').replace(/<article>[\s\S]*?<\/article>/, '');
  assert.equal(extract(unrelatedOnly).body, '');
});

test('matches headlines when JSON-LD has no URL and does not simply choose the first Article', () => {
  const nodes = [
    { '@type': 'Article', headline: 'Judul lain', articleBody: 'SALAH badan berita terkait.' },
    { '@type': ['Thing', 'https://schema.org/NewsArticle'], headline: 'Informasi layanan', articleBody: 'Isi yang benar &amp; informatif.' },
  ];
  const result = extract(htmlArticle('<p>Teaser.</p>', `<script type="application/ld+json">${JSON.stringify(nodes)}</script>`));
  assert.equal(result.extraction.kind, 'json_ld');
  assert.equal(result.body, 'Isi yang benar & informatif.');
  assert.equal(result.extraction.status, 'partial');
});

test('ignores non-live JSON-LD inside templates and unrelated nested recommendation lists', () => {
  const html = `<html><head><title>Informasi layanan</title></head><body>
    <template><script type="application/ld+json">{"@type":"Article","url":"${url}","articleBody":"SALAH template."}</script></template>
    <script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"Article","articleBody":"SALAH rekomendasi."}]}</script>
    <article><h1>Informasi layanan</h1><p>Isi artikel yang terlihat.</p></article></body></html>`;
  assert.equal(extract(html).body, 'Isi artikel yang terlihat.');
});

test('supports only article roots or explicit publisher selectors, with no body/main fallback', () => {
  const html = '<title>Berita warga</title><nav><p>Menu.</p></nav><main><div class="publisher-story"><h1>Berita warga</h1><p>Paragraf layanan warga yang tersedia.</p><p>Informasi tambahan dari kantor.</p></div></main>';
  assert.equal(extract(html).body, '');
  const result = extract(html, { articleSelectors: ['.publisher-story'] });
  assert.equal(result.body, 'Paragraf layanan warga yang tersedia.\n\nInformasi tambahan dari kantor.');
  assert.equal(result.extraction.kind, 'article_html');
});

test('publisher article selector omits navigation, related links, byline and source processing notice', () => {
  const html = `<title>Berita warga</title><div class="wrap__article-detail-content post-content">
    <p>Jakarta (ANTARA) - Pemerintah mengumumkan kebijakan baru untuk kelompok masyarakat.</p>
    <p>Penjelasan pertama mengenai pelaksanaan kebijakan tersebut.</p>
    <p>Informasi tambahan menerangkan alasan dan konteks kebijakan.</p>
    <p><span class="baca-juga">Baca juga: artikel lain.</span></p>
    <p>Pewarta: Nama Reporter<br>Editor: Nama Editor<br>Copyright © ANTARA 2026</p>
    <p class="alert alert-info">Dilarang keras mengambil konten, melakukan crawling atau pengindeksan otomatis untuk AI tanpa izin tertulis.</p>
  </div><section class="related"><p>Berita terkait tidak boleh ikut.</p></section>`;
  const result = extract(html, { articleSelectors: ['.wrap__article-detail-content.post-content'] });
  assert.equal(result.extraction.status, 'full');
  assert.equal(result.paragraphs.length, 3);
  assert.doesNotMatch(result.body, /Baca juga|Pewarta|Editor:|Copyright|Dilarang keras|Berita terkait/iu);
});

test('handles invalid publisher selectors without throwing or losing an ordinary article', () => {
  const result = extract(htmlArticle('<p>Isi singkat.</p>'), { articleSelectors: ['[broken'] });
  assert.equal(result.body, 'Isi singkat.');
  assert.equal(result.extraction.error_code, 'invalid_article_selector');
});

test('does not duplicate nested list/blockquote paragraphs or include a title as article evidence', () => {
  const result = extract(htmlArticle('<blockquote><p>Penjelasan petugas.</p></blockquote><ul><li>Ketentuan pertama.<p>Rincian pertama.</p></li></ul>'));
  assert.equal(result.paragraphs.length, 2);
  assert.equal(result.paragraphs[0].text, 'Penjelasan petugas.');
  assert.match(result.paragraphs[1].text, /Ketentuan pertama\. Rincian pertama\./);
  assert.doesNotMatch(result.body, /Informasi layanan/);
});

test('preserves published and modified dates separately from JSON-LD and Open Graph', () => {
  for (const name of ['article', 'graph']) {
    const result = extract(fixture(name));
    assert.equal(result.published_at, '2026-11-16T02:00:00.000Z');
    assert.equal(result.updated_at, '2026-11-17T03:30:00.000Z');
  }
});

test('uses article time datetime as a fallback and never promotes modified dates to publication', () => {
  const result = extract(htmlArticle('<time itemprop="datePublished" datetime="2026-11-16T02:00:00Z"></time><time class="updated" datetime="2026-11-17T03:30:00Z"></time><p>Isi.</p>'));
  assert.equal(result.published_at, '2026-11-16T02:00:00.000Z');
  assert.equal(result.updated_at, '2026-11-17T03:30:00.000Z');
  const modifiedOnly = extract(htmlArticle('<time itemprop="dateModified" datetime="2026-11-17T03:30:00Z"></time><p>Isi.</p>'));
  assert.equal(modifiedOnly.published_at, null);
  assert.equal(modifiedOnly.updated_at, '2026-11-17T03:30:00.000Z');
  const generic = extract(htmlArticle('<time datetime="2026-11-16T02:00:00Z"></time><p>Isi.</p>'));
  assert.equal(generic.published_at, '2026-11-16T02:00:00.000Z');
});

test('invalid dates and ambiguous date strings stay null without guessing from other page text', () => {
  for (const value of ['not-a-date', '2026-02-30T00:00:00Z', '1', '2026-11-16T02:00:00', '16 November 2026']) {
    const result = extract(htmlArticle('<p>Terbit 16 November 2026.</p>', `<meta property="article:published_time" content="${value}">`));
    assert.equal(result.published_at, null, value);
    assert.equal(result.updated_at, null);
  }
});

test('retains the requested article URL with diagnostics for foreign, homepage and unsafe canonicals', () => {
  for (const [canonical, diagnostic] of [
    ['https://foreign.example/story', 'canonical_cross_origin'],
    ['/', 'canonical_homepage'],
    ['https://user:password@news.example/story', 'canonical_unsafe'],
    ['http://news.example/story', 'canonical_unsafe'],
    ['https://127.0.0.1/private', 'canonical_unsafe'],
    ['https://[::ffff:127.0.0.1]/private', 'canonical_unsafe'],
    ['https://intranet/private', 'canonical_unsafe'],
  ]) {
    const result = extract(htmlArticle('<p>Isi singkat.</p>', `<link rel="canonical" href="${canonical}">`));
    assert.equal(result.canonical_url, url, canonical);
    assert.equal(result.paragraphs[0].source_url, url);
    assert.equal(result.extraction.error_code, diagnostic);
  }
});

test('unsafe requested URLs cannot become evidence sources', () => {
  for (const unsafe of [undefined, 'http://news.example/story', 'https://localhost/story', 'https://10.0.0.1/story', 'https://[::ffff:10.0.0.1]/story', 'https://user:pass@news.example/story']) {
    const result = extractArticleDocument(fixture('article'), { url: unsafe });
    assert.equal(result.canonical_url, null);
    assert.equal(result.extraction.status, 'parse_failed');
    assert.equal(result.extraction.error_code, 'invalid_url');
    assert.equal(result.body, '');
  }
});

test('decodes HTML entities once in title, JSON-LD and visible paragraphs', () => {
  const result = extract('<title>Cadangan</title><article><h1>Warga &amp; biaya &#8212; laporan | Kabar Publik</h1><p>Biaya &lt; Rp100 &amp; syarat&nbsp;lain. &quot;Jelas&quot;.</p></article>', { publisher: 'Kabar Publik' });
  assert.equal(result.title, 'Warga & biaya — laporan');
  assert.equal(result.body, 'Biaya < Rp100 & syarat lain. "Jelas".');
});

test('does not decode already-decoded visible/OG text a second time', () => {
  const h1 = extract('<article><h1>Layanan &amp;amp; biaya</h1><p>Kode &amp;amp; syarat.</p></article>');
  assert.equal(h1.title, 'Layanan &amp; biaya');
  assert.equal(h1.body, 'Kode &amp; syarat.');
  const og = extract('<meta property="og:title" content="Layanan &amp;amp; biaya"><article><p>Isi.</p></article>');
  assert.equal(og.title, 'Layanan &amp; biaya');
});

test('title falls back from h1 to og:title and document title and removes active markup', () => {
  const og = extract('<title>Dokumen | Kabar Publik</title><meta property="og:title" content="Judul &amp; OG | Kabar Publik"><article><p>Isi.</p></article>', { publisher: 'Kabar Publik' });
  assert.equal(og.title, 'Judul & OG');
  assert.equal(extract('<title>Dokumen | Kabar Publik</title><article><p>Isi.</p></article>', { publisher: 'Kabar Publik' }).title, 'Dokumen');
  const unsafe = extract('<meta property="og:title" content="&lt;script&gt;throw 1&lt;/script&gt;Judul aman"><article><p>Isi.</p></article>');
  assert.equal(unsafe.title, 'Judul aman');
});

test('an h1 title omits hidden and script/style descendants before normalization', () => {
  const result = extract('<article><h1>Judul <script>malicious()</script><style>.x{}</style><span hidden>HIDDEN</span><span>aman</span></h1><p>Isi.</p></article>');
  assert.equal(result.title, 'Judul aman');
});

test('malformed JSON-LD can fall back to real HTML with a parse diagnostic', () => {
  const result = extract(fixture('malformed-json'));
  assert.equal(result.extraction.kind, 'article_html');
  assert.equal(result.extraction.status, 'full');
  assert.equal(result.extraction.error_code, 'invalid_json_ld');
  assert.match(result.body, /Layanan warga dibuka/);
  const onlyMalformed = extract('<script type="application/ld+json">{ broken }</script>');
  assert.equal(onlyMalformed.extraction.status, 'parse_failed');
  assert.equal(onlyMalformed.body, '');
});

test('sniffs Buffer charset from meta and accepts an HTTP charset override', () => {
  const source = fixture('encoded');
  const windows = Buffer.from(source.replace('€', '\u0080'), 'latin1');
  const meta = extract(windows);
  assert.equal(meta.title, 'Kabar café & biaya');
  assert.equal(meta.body, 'Harga café naik €2 setelah evaluasi biaya.');
  const override = extract(Buffer.from(source, 'utf8'), { charset: 'utf-8' });
  assert.equal(override.body, 'Harga café naik €2 setelah evaluasi biaya.');
});

test('handles malformed or unsupported encoding as an explicit failure', () => {
  const bytes = Buffer.concat([Buffer.from('<meta charset="utf-8"><article><p>Rusak '), Buffer.from([0xc3, 0x28]), Buffer.from('</p></article>')]);
  const result = extract(bytes);
  assert.equal(result.extraction.status, 'parse_failed');
  assert.equal(result.extraction.error_code, 'invalid_encoding');
  assert.equal(result.body, '');
  assert.equal(extract(Buffer.from('<article><p>Isi.</p></article>'), { charset: 'not-a-charset' }).extraction.error_code, 'invalid_encoding');
});

test('explicit paid metadata prevents extraction even without a visible HTML paywall', () => {
  const html = fixture('paywall').replace(/<div class="content-requires-login">[\s\S]*?<\/div>/, '');
  const result = extract(html);
  assert.equal(result.extraction.status, 'paywall');
  assert.equal(result.extraction.error_code, 'paywall');
  assert.equal(result.body, '');
  assert.deepEqual(result.paragraphs, []);
  assert.deepEqual(result.images, []);
});

test('visible login/paywall blocks also suppress JSON-LD that claims to be free', () => {
  const result = extract(fixture('paywall').replace('"isAccessibleForFree":false', '"isAccessibleForFree":true'));
  assert.equal(result.extraction.status, 'paywall');
  assert.equal(result.body, '');
  assert.deepEqual(result.paragraphs, []);
  assert.equal(extract('<h1>Sign in to continue reading</h1><p>Login required.</p>').extraction.status, 'paywall');
});

test('prominent login blocks without a special class are a paywall and not article material', () => {
  const result = extract(htmlArticle('<p>Teaser.</p><div role="dialog"><p>Log in to read the full article.</p></div>'));
  assert.equal(result.extraction.status, 'paywall');
  assert.equal(result.body, '');
});

test('supports paid WebPage metadata for the current article', () => {
  const graph = { '@graph': [
    { '@type': 'WebPage', '@id': '#page', url, isAccessibleForFree: false },
    { '@type': 'Article', url, articleBody: 'Paid body that cannot become evidence.' },
  ] };
  const result = extract(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`);
  assert.equal(result.extraction.status, 'paywall');
  assert.equal(result.body, '');
});

test('referenced paid hasPart sections prevent extraction of their hidden JSON-LD bodies', () => {
  const graph = { '@graph': [
    { '@type': 'Article', url, articleBody: 'Paid body that cannot become evidence.', hasPart: { '@id': '#restricted' } },
    { '@type': 'WebPageElement', '@id': '#restricted', isAccessibleForFree: false },
  ] };
  const result = extract(`<script type="application/ld+json">${JSON.stringify(graph)}</script>`);
  assert.equal(result.extraction.status, 'paywall');
  assert.equal(result.body, '');
});

test('plain short login notices suppress article teaser extraction', () => {
  const result = extract(htmlArticle('<p>Teaser.</p><p>Log in to read the full article.</p>'));
  assert.equal(result.extraction.status, 'paywall');
  assert.equal(result.body, '');
});

test('ignores hidden subscription widgets and paid metadata belonging to an unrelated article', () => {
  const html = fixture('related-only').replace('"headline":"Cerita lain"', '"headline":"Cerita lain","isAccessibleForFree":false').replace('</article>', '<div class="paywall" hidden>Subscribe to continue reading</div><p>Petugas membahas login portal layanan.</p></article>');
  const result = extract(html);
  assert.equal(result.extraction.status, 'full');
  assert.match(result.body, /login portal layanan/);
});

test('anti-bot and access denied pages cannot expose embedded article bodies', () => {
  const result = extract(fixture('blocked'));
  assert.equal(result.extraction.status, 'access_denied');
  assert.equal(result.body, '');
  assert.deepEqual(result.paragraphs, []);
  assert.equal(extract('<title>Access Denied</title><h1>Access Denied</h1>').extraction.status, 'access_denied');
});

test('summary metadata is not invented into paragraphs; sparse or absent content is never full', () => {
  const summary = extract(fixture('summary'));
  assert.deepEqual(summary.extraction, { kind: null, status: 'summary_only', error_code: 'no_article_body' });
  assert.equal(summary.body, '');
  assert.deepEqual(summary.paragraphs, []);
  const sparse = extract(htmlArticle('<p>Satu kalimat singkat.</p>'));
  assert.equal(sparse.extraction.status, 'partial');
  const empty = extract(htmlArticle(''));
  assert.equal(empty.extraction.status, 'parse_failed');
  assert.equal(empty.body, '');
});

test('JSON-LD description is summary metadata and never substitutes for articleBody', () => {
  const result = extract('<h1>Informasi layanan</h1><script type="application/ld+json">{"@type":"Article","headline":"Informasi layanan","description":"Ringkasan saja."}</script>');
  assert.equal(result.extraction.status, 'summary_only');
  assert.equal(result.body, '');
  assert.deepEqual(result.paragraphs, []);
});

test('collects only public HTTPS image syntax from OG, Twitter, JSON-LD and lazy article attributes', () => {
  const html = htmlArticle(`<p>Isi.</p><img data-lazy-src="/lazy.jpg" alt="Foto &amp; layanan"><img srcset="/small.jpg 320w, /large.jpg 1200w">
    ${['http://cdn.example/a.jpg', 'https://u:p@cdn.example/a.jpg', 'https://localhost/a.jpg', 'https://10.0.0.1/a.jpg', 'https://[::ffff:127.0.0.1]/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA'].map((src) => `<img src="${src}">`).join('')}`,
  '<meta property="og:image" content="//cdn.example/og.jpg"><meta name="twitter:image" content="/twitter.jpg"><meta name="twitter:image:alt" content="Akun warga">');
  const result = extract(html);
  assert.deepEqual(result.images.map((image) => image.url), ['https://cdn.example/og.jpg', 'https://news.example/twitter.jpg', 'https://news.example/lazy.jpg', 'https://news.example/small.jpg', 'https://news.example/large.jpg']);
  assert.equal(result.images[1].alt, 'Akun warga');
  assert.ok(result.images.every((image) => image.source_url === url));
});

test('relative image URLs resolve against the final document URL even when canonical uses a different path', () => {
  const result = extract(htmlArticle('<p>Isi.</p><img src="photo.jpg" alt="Foto">', '<link rel="canonical" href="/archive/renamed">'));
  assert.equal(result.images[0].url, 'https://news.example/politik/photo.jpg');
  assert.equal(result.images[0].source_url, 'https://news.example/archive/renamed');
});

test('resolves ImageObject @id URLs and does not turn a data-URI srcset into invented relative images', () => {
  const node = { '@type': 'Article', url, articleBody: 'Isi artikel.', image: { '@type': 'ImageObject', '@id': 'https://cdn.example/photo.jpg', caption: 'Foto asli' } };
  const html = htmlArticle('<p>Isi.</p><img srcset="data:image/png;base64,AAAA 1x">', `<script type="application/ld+json">${JSON.stringify(node)}</script>`);
  const result = extract(html);
  assert.deepEqual(result.images, [{ url: 'https://cdn.example/photo.jpg', source_url: url, alt: 'Foto asli' }]);
});

test('does not use off-article navigation timestamps as publication metadata', () => {
  const result = extract('<nav><time datetime="2026-11-01T00:00:00Z"></time></nav><aside><time class="updated" datetime="2026-11-02T00:00:00Z"></time></aside><article><h1>Informasi layanan</h1><p>Isi.</p><time datetime="2026-11-16T02:00:00Z"></time></article>');
  assert.equal(result.published_at, '2026-11-16T02:00:00.000Z');
  assert.equal(result.updated_at, null);
});

test('article publication time wins over an unrelated site clock or related-story datetime', () => {
  const result = extract('<header><time datetime="2026-11-01T00:00:00Z"></time></header><article><h1>Informasi layanan</h1><div class="related-story"><time datetime="2026-11-02T00:00:00Z"></time></div><time itemprop="datePublished" datetime="2026-11-16T02:00:00Z"></time><p>Isi.</p></article>');
  assert.equal(result.published_at, '2026-11-16T02:00:00.000Z');
});

test('parses HTML-formatted articleBody in JSON-LD without script/style text or duplicate evidence', () => {
  const node = { '@type': 'Article', url, articleBody: '<p>Berita &amp; informasi.</p><h2>Rincian</h2><ul><li>Ketentuan pertama.</li></ul><script>malicious()</script>' };
  const result = extract(`<script type="application/ld+json">${JSON.stringify(node).replaceAll('</script>', '<\\/script>')}</script>`);
  assert.equal(result.extraction.kind, 'json_ld');
  assert.equal(result.body, 'Berita & informasi.\n\nRincian\n\nKetentuan pertama.');
});

test('input and extracted text size limits fail explicitly instead of silently truncating', () => {
  for (const input of ['x'.repeat(2 * 1024 * 1024 + 1), Buffer.alloc(2 * 1024 * 1024 + 1, 65), htmlArticle(`<p>${'x'.repeat(100001)}</p>`)]) {
    const result = extract(input);
    assert.equal(result.extraction.status, 'parse_failed');
    assert.equal(result.extraction.error_code, 'response_too_large');
    assert.equal(result.body, '');
    assert.deepEqual(result.paragraphs, []);
  }
  const oversizedJson = { '@type': 'Article', url, articleBody: 'x'.repeat(100001) };
  assert.equal(extract(`<script type="application/ld+json">${JSON.stringify(oversizedJson)}</script>`).extraction.error_code, 'response_too_large');
});

test('three real paragraphs count as full even when the article is concise', () => {
  const result = extract(htmlArticle('<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>'));
  assert.equal(result.extraction.status, 'full');
  assert.equal(result.paragraphs.length, 3);
});

test('JSON-LD traversal is bounded by both depth and total node count', () => {
  let node = { '@type': 'Article', url, articleBody: 'Too deep.' };
  for (let index = 0; index < 40; index++) node = { child: node };
  const many = { '@graph': Array.from({ length: 2500 }, () => ({ '@type': 'Thing' })) };
  for (const value of [node, many]) {
    const result = extract(`<script type="application/ld+json">${JSON.stringify(value)}</script>`);
    assert.equal(result.extraction.status, 'parse_failed');
    assert.equal(result.extraction.error_code, 'json_ld_limit');
    assert.equal(result.body, '');
  }
});

test('invalid input is a consistent result and extraction never calls fetch or opens assets', () => {
  for (const input of [null, undefined, {}, 12, '']) {
    const result = extract(input);
    assert.equal(result.extraction.status, 'parse_failed');
    assert.equal(result.body, '');
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('No network allowed'); };
  try {
    const result = extract(fixture('article'));
    assert.equal(result.extraction.status, 'full');
    assert.ok(result.images.length);
  } finally { globalThis.fetch = originalFetch; }
});

test('stylesheet-hidden article text never becomes reporting evidence or boosts extraction completeness', () => {
  const result = extract(htmlArticle('<p>Public teaser.</p><div class="paid-body"><p>Restricted paragraph A.</p><p>Restricted paragraph B.</p></div>', '<style>.paid-body { display: none !important; }</style>'));
  assert.equal(result.body, 'Public teaser.');
  assert.equal(result.paragraphs.length, 1);
  assert.equal(result.extraction.status, 'partial');
});
