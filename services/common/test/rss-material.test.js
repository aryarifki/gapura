import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, parseFeed, stripHtml } from '../rss.js';

const articleUrl = 'https://www.antaranews.com/berita/1';
const rss = (body) => `<rss><channel><item><title>Kebijakan baru - Antara</title><link>${articleUrl}</link>${body}</item></channel></rss>`;

test('RSS preserves explicit full material separately from the short radar description', () => {
  const fullText = `${'Bukti laporan yang tersedia di feed. '.repeat(80)}Penutup sumber.`;
  const html = `<p>${fullText}</p><p>Paragraf kedua &amp; rincian.</p>`;
  const [item] = parseFeed(rss(`<description>Ringkasan radar.</description><content:encoded><![CDATA[${html}]]></content:encoded>
    <pubDate>Mon, 16 Nov 2026 09:00:00 GMT</pubDate><updated>2026-11-17T10:00:00Z</updated>
    <dc:creator>Reporter Antara</dc:creator><source url="https://www.antaranews.com">Antara</source>`));
  assert.equal(item.content, `${fullText} Paragraf kedua & rincian.`);
  assert.equal(item.description, 'Ringkasan radar.');
  assert.equal(item.content_kind, 'rss_full');
  assert.match(item.content_html, /<p>Paragraf kedua/);
  assert.equal(item.raw_title, 'Kebijakan baru - Antara');
  assert.equal(item.title, item.raw_title);
  assert.equal(item.pubDate, 'Mon, 16 Nov 2026 09:00:00 GMT');
  assert.equal(item.updated_at, '2026-11-17T10:00:00Z');
  assert.equal(item.author, 'Reporter Antara');
  assert.equal(item.extra.sourceName, 'Antara');
  assert.equal(item.extra.sourceUrl, 'https://www.antaranews.com');
});

test('description-only material stays complete but is honestly a feed summary', () => {
  const body = 'Keterangan lengkap dari deskripsi feed. '.repeat(80).trim();
  const [item] = parseFeed(rss(`<description><![CDATA[<p>${body}</p>]]></description>`));
  assert.equal(item.content, body);
  assert.equal(item.content_kind, 'feed_summary');
  assert.equal(item.description, body.slice(0, 1000));
  assert.equal(item.content_html, '');
  assert.equal(item.updated_at, null);
});

test('empty encoded content falls through to content before falling back to description', () => {
  const [full] = parseFeed(rss('<content:encoded><![CDATA[<p>&nbsp;</p><script>ignored()</script>]]></content:encoded><content><![CDATA[<p>Materi eksplisit.</p>]]></content><description>Ringkasan.</description>'));
  assert.equal(full.content, 'Materi eksplisit.');
  assert.equal(full.content_kind, 'rss_full');
  const [summary] = parseFeed(rss('<content:encoded><![CDATA[<style>ignored</style>]]></content:encoded><description>Ringkasan.</description>'));
  assert.equal(summary.content, 'Ringkasan.');
  assert.equal(summary.content_kind, 'feed_summary');
});

test('Atom keeps XHTML paragraphs, alternate article URL, publication and update separately', () => {
  const [item] = parseFeed(`<feed><entry><source><title>Media Uji</title><link href="https://publisher.example.org"/></source>
    <title>Judul Atom</title><link rel="self" href="https://feeds.example.org/entries/1"/>
    <link rel="alternate" href="https://publisher.example.org/news/1"/>
    <published>2026-11-16T09:00:00Z</published><updated>2026-11-17T09:00:00Z</updated>
    <author><name>Penulis Uji</name><uri>https://publisher.example.org/author/1</uri></author>
    <summary>Ringkas.</summary><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Fakta pertama.</p><p>Fakta kedua.</p></div></content>
  </entry></feed>`);
  assert.equal(item.title, 'Judul Atom');
  assert.equal(item.link, 'https://publisher.example.org/news/1');
  assert.equal(item.content, 'Fakta pertama. Fakta kedua.');
  assert.match(item.content_html, /<p>Fakta pertama\.<\/p><p>Fakta kedua\.<\/p>/);
  assert.equal(item.pubDate, '2026-11-16T09:00:00Z');
  assert.equal(item.updated_at, '2026-11-17T09:00:00Z');
  assert.equal(item.author, 'Penulis Uji');
  assert.equal(item.extra.sourceName, 'Media Uji');
  assert.equal(item.extra.sourceUrl, 'https://publisher.example.org');
});

test('an Atom update alone is not invented as the publication timestamp', () => {
  const [item] = parseFeed('<feed><entry><title>Judul lengkap Atom</title><id>https://publisher.example.org/1</id><updated>2026-11-17T09:00:00Z</updated><content type="text">Materi Atom.</content></entry></feed>');
  assert.equal(item.pubDate, null);
  assert.equal(item.updated_at, '2026-11-17T09:00:00Z');
  assert.equal(item.content, 'Materi Atom.');
});

test('image candidates retain media, enclosure and body images with safe relative resolution', () => {
  const [item] = parseFeed(rss(`<media:thumbnail url="https://pbs.twimg.com/media/thumb.jpg"/>
    <media:content url="https://cdn.example.org/media/cover.jpg" type="image/jpeg"/>
    <enclosure url="https://cdn.example.org/media/audio.mp3" type="audio/mpeg"/>
    <enclosure url="https://img.antaranews.com/cover.webp" type="image/webp"/>
    <description><![CDATA[<img src="https://pbs.twimg.com/media/summary.jpg">Ringkasan.]]></description>
    <content:encoded><![CDATA[<p>Laporan.</p><img src="/images/hero.jpg?size=large&amp;v=1"><img src="//pbs.twimg.com/media/body.jpg">
    <img src="javascript:alert(1)"><img src="https://127.0.0.1/private.png"><img src="https://user:pass@pbs.twimg.com/private.png">]]></content:encoded>`));
  assert.ok(item.images.includes('https://pbs.twimg.com/media/thumb.jpg'));
  assert.ok(item.images.includes('https://cdn.example.org/media/cover.jpg'));
  assert.ok(item.images.includes('https://img.antaranews.com/cover.webp'));
  assert.ok(item.images.includes('https://pbs.twimg.com/media/summary.jpg'));
  assert.ok(item.images.includes('https://www.antaranews.com/images/hero.jpg?size=large&v=1'));
  assert.ok(item.images.includes('https://pbs.twimg.com/media/body.jpg'));
  assert.ok(item.images.includes(item.image_url));
  assert.ok(item.images.every((url) => !/audio|javascript|127\.0\.0\.1|user:pass/.test(url)));
});

test('entity decoding uses one pass and invalid code points never crash the feed parser', () => {
  assert.equal(decodeEntities('&amp;lt;script&amp;gt;'), '&lt;script&gt;');
  assert.equal(decodeEntities('&#x1f600; &#1114112; &#xD800; &#0;'), '😀 � � �');
  assert.equal(stripHtml('<p>Fakta</p><script>bad()</script><style>.bad{}</style>'), 'Fakta');
  const [item] = parseFeed(rss('<content:encoded><![CDATA[<p>Fakta &#9999999999999999;</p><script>bad()</script><style>.bad{}</style>]]></content:encoded>'));
  assert.equal(item.content, 'Fakta �');
  assert.doesNotMatch(item.content_html, /script|bad\(\)/i);
  assert.match(item.content_html, /<style>\.bad\{\}<\/style>/, 'source-only HTML retains CSS for downstream visibility pruning');
});

test('full material rejects oversized source bodies explicitly instead of truncating', () => {
  const valid = 'a'.repeat(100_000);
  assert.equal(parseFeed(rss(`<content:encoded><![CDATA[${valid}]]></content:encoded>`))[0].content.length, 100_000);
  assert.throws(() => parseFeed(rss(`<content:encoded><![CDATA[${valid}a]]></content:encoded>`)), /feed.*100000|100000.*feed/i);
  assert.throws(() => parseFeed(rss(`<description>${valid}a</description>`)), /feed.*100000|100000.*feed/i);
});

test('Google Trends extras remain available alongside additive material fields', () => {
  const [item] = parseFeed(rss('<ht:approx_traffic>20,000+</ht:approx_traffic><ht:news_item><ht:news_item_title>Berita tren</ht:news_item_title><ht:news_item_url>https://publisher.example.org/1</ht:news_item_url><ht:news_item_source>Media Uji</ht:news_item_source></ht:news_item>'));
  assert.equal(item.extra.approxTraffic, '20,000+');
  assert.deepEqual(item.extra.newsItems, [{ title: 'Berita tren', url: 'https://publisher.example.org/1', source: 'Media Uji' }]);
  assert.deepEqual(parseFeed(null), []);
});

test('CDATA titles and image-only descriptions survive material extraction', () => {
  const [item] = parseFeed('<rss><channel><item><title><![CDATA[Judul asli &amp; rinci - Antara]]></title><link>https://x.com/media/status/1</link><description><![CDATA[<img src="https://pbs.twimg.com/media/only.jpg">]]></description></item></channel></rss>');
  assert.equal(item?.title, 'Judul asli & rinci - Antara');
  assert.equal(item.content, '');
  assert.equal(item.content_kind, 'feed_summary');
  assert.deepEqual(item.images, ['https://pbs.twimg.com/media/only.jpg']);
});

test('Atom HTML encoding is unwrapped once while safe paragraph boundaries remain usable', () => {
  const [item] = parseFeed('<feed><entry><title>Judul Atom</title><id>https://publisher.example.org/1</id><content type="html">&lt;p&gt;Fakta &amp;amp; rincian.&lt;/p&gt;&lt;p&gt;Fakta kedua.&lt;/p&gt;&lt;script&gt;ignore()&lt;/script&gt;</content></entry></feed>');
  assert.equal(item.content, 'Fakta & rincian. Fakta kedua.');
  assert.match(item.content_html, /<p>Fakta &amp; rincian\.<\/p><p>Fakta kedua\.<\/p>/);
  assert.doesNotMatch(item.content_html, /script|ignore\(\)/);
});

test('oversized unusable explicit bodies are rejected even when a short summary exists', () => {
  assert.throws(() => parseFeed(rss(`<content:encoded><![CDATA[<script>${'a'.repeat(100_001)}</script>]]></content:encoded><description>Ringkas.</description>`)), /feed.*100000|100000.*feed/i);
});

test('opt-in item error isolation retains the failed slot and parses the following material', () => {
  const xml = `<rss><channel>
    <item><title>Oversized item</title><link>${articleUrl}/large</link><content:encoded><![CDATA[${'a'.repeat(100_001)}]]></content:encoded></item>
    <item><title>Valid item</title><link>${articleUrl}/valid</link><content:encoded><![CDATA[<p>First</p><h2>Middle</h2><p>Last</p>]]></content:encoded></item>
  </channel></rss>`;
  assert.throws(() => parseFeed(xml), /100000/);
  const items = parseFeed(xml, { isolateErrors: true });
  assert.equal(items.length, 2);
  assert.ok(items[0].error instanceof RangeError);
  assert.match(items[0].error.message, /100000/);
  assert.equal(items[1].content, 'First Middle Last');
  assert.equal(items[1].content_html, '<p>First</p><h2>Middle</h2><p>Last</p>');
});

test('source-only HTML retains stylesheet visibility rules while public feed text excludes CSS and scripts', () => {
  const html = '<style>.hidden { display: none; }</style><p class="hidden">Hidden evidence.</p><p>Visible evidence.</p><script>ignore()</script>';
  const [item] = parseFeed(rss(`<content:encoded><![CDATA[${html}]]></content:encoded>`));
  assert.match(item.content_html, /<style>\.hidden \{ display: none; \}<\/style>/);
  assert.match(item.content_html, /class="hidden"/);
  assert.doesNotMatch(item.content_html, /script|ignore\(\)/);
  assert.doesNotMatch(item.content, /display|ignore\(\)/);
});
