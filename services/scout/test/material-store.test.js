import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { persistTopicMaterial, loadLatestTopicMaterial } from '../material-store.js';

const articleUrl = 'https://publisher.example.org/news/one';
function material(overrides = {}) {
  const text = '  Isi lengkap artikel tetap dipertahankan, termasuk whitespace dan tanggal sumber.\n'.repeat(24);
  return {
    version: 1,
    raw_title: '[X] Kebijakan untuk warga - Penerbit Uji',
    headline: 'Kebijakan untuk warga',
    provider: 'google_news_proxy',
    publisher: 'Penerbit Uji',
    discovery_url: 'https://news.google.com/rss/articles/fixture',
    article_url: articleUrl,
    published_at: '2026-11-15T07:00:00.000Z',
    updated_at: '2026-11-16T08:00:00.000Z',
    retrieved_at: '2026-11-17T09:00:00.000Z',
    body: text,
    paragraphs: [{ id: 'p1', text, source_url: articleUrl, role: 'reporting' }],
    images: [],
    discovery_summary: 'Summary remains separate from the full source body.',
    extraction: { kind: 'article_html', status: 'partial', error_code: null },
    ...overrides,
  };
}

function recordingDb(inserted = true) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: '42', content_hash: params[1], inserted }] };
    },
  };
}

function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
  return value;
}

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  return value;
}

test('stores the complete structured snapshot with bound parameters and no topic/draft writes', async () => {
  const db = recordingDb();
  const input = material();
  const original = structuredClone(input);
  const result = await persistTopicMaterial(db, '17', input);
  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  assert.match(sql, /INSERT INTO topic_materials\s*\(topic_id,\s*content_hash,\s*material\)/i);
  assert.equal(params[0], '17');
  assert.deepEqual(JSON.parse(params[2]), input);
  assert.ok(input.body.length > 1000);
  assert.equal(JSON.parse(params[2]).body, original.body);
  const { retrieved_at, ...content } = input;
  const expectedHash = createHash('sha256').update(JSON.stringify(sorted(content))).digest('hex');
  assert.equal(params[1], expectedHash);
  assert.deepEqual(result, { id: '42', content_hash: expectedHash, is_existing: false });
  assert.deepEqual(input, original, 'hashing/persistence never normalizes or mutates source evidence');
  assert.doesNotMatch(sql, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+(?:topics|raw_items|trend_items|drafts|scheduled_posts)\b/i);
});

test('hashing sorts nested keys and excludes only the top-level retrieval time', async () => {
  const db = recordingDb();
  const first = material({ metadata: { z: 'last', a: { b: 2, a: 1 }, retrieved_at: 'source-specific-metadata' } });
  const repeated = reverseKeys({ ...first, retrieved_at: '2026-11-18T10:00:00+07:00' });
  const a = await persistTopicMaterial(db, 1, first);
  const b = await persistTopicMaterial(db, 1, repeated);
  assert.equal(a.content_hash, b.content_hash);
  assert.equal(JSON.parse(db.calls[0].params[2]).retrieved_at, first.retrieved_at);
  assert.equal(JSON.parse(db.calls[1].params[2]).retrieved_at, repeated.retrieved_at);
  const nested = await persistTopicMaterial(db, 1, { ...first, metadata: { ...first.metadata, retrieved_at: 'changed-source-metadata' } });
  assert.notEqual(a.content_hash, nested.content_hash);
});

test('source body, paragraph order, attribution, dates, URLs, status and extra metadata all affect the hash', async () => {
  const db = recordingDb();
  const input = material({ images: ['https://images.example.org/one.jpg'] });
  const baseline = (await persistTopicMaterial(db, 1, input)).content_hash;
  const changes = [
    { raw_title: 'Asli berbeda' }, { headline: 'Judul berbeda' }, { provider: 'rss' }, { publisher: null },
    { discovery_url: 'https://news.google.com/rss/articles/other' }, { article_url: null },
    { published_at: null }, { updated_at: '2026-11-16T08:00:01Z' }, { body: `${input.body}\nTambahan.` },
    { images: ['https://images.example.org/two.jpg'] }, { extra: { first: 1 } },
    ...['id', 'text', 'source_url', 'role'].map((key) => ({
      paragraphs: [{ ...input.paragraphs[0], [key]: { id: 'p2', text: 'Paragraf lain.', source_url: 'https://publisher.example.org/other', role: 'document' }[key] }],
    })),
    ...[{ kind: 'json_ld' }, { status: 'full' }, { error_code: 'truncated_upstream' }].map((change) => ({ extraction: { ...input.extraction, ...change } })),
  ];
  for (const change of changes) {
    const result = await persistTopicMaterial(db, 1, { ...input, ...change });
    assert.notEqual(result.content_hash, baseline, JSON.stringify(change));
  }
  const discoverySummary = await persistTopicMaterial(db, 1, { ...input, discovery_summary: 'Ringkasan Radar baru.' });
  assert.notEqual(discoverySummary.content_hash, baseline);
  const paragraphs = [input.paragraphs[0], { ...input.paragraphs[0], id: 'p2', text: 'Paragraf kedua.' }];
  const ordered = await persistTopicMaterial(db, 1, material({ paragraphs }));
  const reversed = await persistTopicMaterial(db, 1, material({ paragraphs: [...paragraphs].reverse() }));
  assert.notEqual(ordered.content_hash, reversed.content_hash);
});

test('duplicates only refresh last_seen_at and report an existing immutable snapshot', async () => {
  const db = recordingDb(false);
  const result = await persistTopicMaterial(db, 1, material());
  assert.equal(result.is_existing, true);
  const sql = db.calls[0].sql.replace(/\s+/g, ' ');
  assert.match(sql, /ON CONFLICT \(topic_id, content_hash\) DO UPDATE SET last_seen_at = NOW\(\)/i);
  assert.match(sql, /RETURNING id, content_hash, \(xmax = 0\) AS inserted/i);
  const update = sql.match(/DO UPDATE SET (.*?) RETURNING/i)[1];
  assert.equal(update.trim(), 'last_seen_at = NOW()');
});

test('partial, summary and failure evidence is storable without three sufficient paragraphs', async () => {
  const db = recordingDb();
  const statuses = ['partial', 'summary_only', 'paywall', 'access_denied', 'robots_disallowed', 'rate_limited', 'parse_failed', 'unavailable'];
  for (const status of statuses) {
    const input = material({ body: '', paragraphs: [], article_url: null, published_at: null, updated_at: null,
      extraction: { kind: 'feed_summary', status, error_code: status === 'summary_only' ? null : 'fixture_code' } });
    await persistTopicMaterial(db, 1, input);
    assert.deepEqual(JSON.parse(db.calls.at(-1).params[2]), input);
  }
  for (const kind of ['rss_full', 'feed_summary', 'article_html', 'json_ld', 'x_post']) {
    await persistTopicMaterial(db, 1, material({ extraction: { kind, status: 'partial', error_code: null } }));
  }
  for (const status of ['paywall', 'access_denied', 'robots_disallowed', 'rate_limited', 'parse_failed', 'unavailable']) {
    const input = material({ body: '', paragraphs: [], article_url: null, published_at: null, updated_at: null,
      extraction: { kind: null, status, error_code: 'fixture_unavailable' } });
    await persistTopicMaterial(db, 1, input);
    assert.deepEqual(JSON.parse(db.calls.at(-1).params[2]), input);
  }
  const summaryWithoutBody = material({ body: '', paragraphs: [], extraction: { kind: null, status: 'summary_only', error_code: 'no_article_body' } });
  await persistTopicMaterial(db, 1, summaryWithoutBody);
  assert.deepEqual(JSON.parse(db.calls.at(-1).params[2]), summaryWithoutBody);
});

test('full material requires a nonempty body and at least one paragraph, while discovery summary stays separate', async () => {
  const db = recordingDb();
  const input = material({ extraction: { kind: 'article_html', status: 'full', error_code: null } });
  await persistTopicMaterial(db, 1, input);
  assert.equal(JSON.parse(db.calls[0].params[2]).discovery_summary, input.discovery_summary);
  for (const change of [{ body: '' }, { body: '  \n' }, { paragraphs: [] }]) {
    const next = { ...input, ...change };
    await assert.rejects(() => persistTopicMaterial(recordingDb(), 1, next), /body|material/i);
  }
});

test('image candidates retain all attribution metadata and every paragraph role without rights fabrication', async () => {
  const db = recordingDb();
  const input = material({
    images: [{ url: 'https://images.example.org/fixture.jpg', source_url: articleUrl, alt: 'Foto sumber', credit: null }, 'https://images.example.org/other.jpg'],
    paragraphs: ['reporting', 'document', 'official_statement'].map((role, index) => ({
      id: `p${index + 1}`, text: `Paragraf sumber ${index + 1}.`, source_url: articleUrl, role,
    })),
  });
  await persistTopicMaterial(db, 1, input);
  assert.deepEqual(JSON.parse(db.calls[0].params[2]), input);
  assert.equal(Object.hasOwn(JSON.parse(db.calls[0].params[2]).images[0], 'rights_basis'), false);
});

test('the body limit is inclusive and over-limit evidence is rejected rather than truncated', async () => {
  const db = recordingDb();
  const input = material({ body: 'a'.repeat(100000), paragraphs: [] });
  await persistTopicMaterial(db, 1, input);
  assert.equal(JSON.parse(db.calls[0].params[2]).body.length, 100000);
  await assert.rejects(() => persistTopicMaterial(db, 1, { ...input, body: `${input.body}b` }), /body|material/i);
  assert.equal(db.calls.length, 1);
  assert.equal(input.body.length, 100000);
});

test('invalid structures, timestamps, URLs and paragraph references fail before any database query', async () => {
  const invalid = [
    null, [], 'body', material({ version: 2 }), material({ version: '1' }),
    material({ body: undefined }), material({ body: null }), material({ body: ['not text'] }),
    material({ raw_title: undefined }), material({ headline: 1 }), material({ provider: {} }), material({ publisher: [] }),
    material({ published_at: undefined }), material({ published_at: 'yesterday' }), material({ published_at: '2026-02-30T00:00:00Z' }),
    material({ updated_at: '2026-11-16' }), material({ retrieved_at: null }), material({ retrieved_at: 1000 }),
    material({ discovery_url: 'http://publisher.example.org/article' }), material({ discovery_url: 'https://user:pass@publisher.example.org/article' }),
    material({ article_url: 'https://127.0.0.1/article' }), material({ article_url: '/article' }), material({ article_url: undefined }),
    material({ images: null }), material({ images: ['javascript:alert(1)'] }), material({ images: [null] }),
    material({ images: [{ url: 'https://images.example.org/a.jpg', source_url: 'https://localhost/private' }] }),
    material({ discovery_summary: {} }),
    material({ extraction: null }), material({ extraction: { kind: 'magic', status: 'full', error_code: null } }),
    material({ extraction: { kind: 'article_html', status: 'verified', error_code: null } }),
    material({ extraction: { kind: null, status: 'partial', error_code: null } }),
    material({ extraction: { kind: 'article_html', status: 'partial', error_code: {} } }),
    material({ paragraphs: undefined }), material({ paragraphs: {} }), material({ paragraphs: [null] }),
    material({ paragraphs: ['text'] }),
    ...[{ id: '' }, { id: ' p1 ' }, { text: '' }, { source_url: '' }, { source_url: 'https://localhost/private' }, { role: 'summary' }]
      .map((change) => material({ paragraphs: [{ ...material().paragraphs[0], ...change }] })),
    material({ paragraphs: [material().paragraphs[0], material().paragraphs[0]] }),
  ];
  for (const input of invalid) {
    const db = recordingDb();
    await assert.rejects(() => persistTopicMaterial(db, 1, input), /material|body|paragraph|date|url|title/i);
    assert.equal(db.calls.length, 0);
  }
});

test('non-JSON metadata cannot silently disappear or change during hashing and storage', async () => {
  const circular = {}; circular.self = circular;
  const invalid = [undefined, () => 'hidden', Symbol('hidden'), NaN, Infinity, 1n, new Date(), circular, { toJSON() { return 'hidden'; } }, Array(1)];
  for (const extra of invalid) {
    const db = recordingDb();
    await assert.rejects(() => persistTopicMaterial(db, 1, material({ extra })), /material|json/i);
    assert.equal(db.calls.length, 0);
  }
});

test('latest material uses observation chronology and deterministic ID ordering', async () => {
  const expected = { id: '17', topic_id: '2', material: material(), content_hash: 'a'.repeat(64), created_at: 'earlier', last_seen_at: 'later' };
  const calls = [];
  const db = { async query(sql, params) { calls.push({ sql, params }); return { rows: [expected] }; } };
  assert.deepEqual(await loadLatestTopicMaterial(db, '2'), expected);
  assert.deepEqual(calls[0].params, ['2']);
  assert.match(calls[0].sql, /WHERE topic_id\s*=\s*\$1/i);
  assert.match(calls[0].sql, /ORDER BY last_seen_at DESC,\s*id DESC\s+LIMIT 1/i);
  assert.doesNotMatch(calls[0].sql, /INSERT|UPDATE|DELETE/i);
  assert.equal(await loadLatestTopicMaterial({ async query() { return { rows: [] }; } }, 2), null);
});

test('invalid topic IDs never reach the database and bigint string IDs remain exact', async () => {
  for (const topicId of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, undefined, [], {}, '0', '1; DELETE FROM topics', '9223372036854775808']) {
    const db = recordingDb();
    await assert.rejects(() => persistTopicMaterial(db, topicId, material()), /topic/i);
    await assert.rejects(() => loadLatestTopicMaterial(db, topicId), /topic/i);
    assert.equal(db.calls.length, 0);
  }
  const db = recordingDb();
  await persistTopicMaterial(db, '9223372036854775807', material());
  assert.equal(db.calls[0].params[0], '9223372036854775807');
});

test('database errors propagate to the caller without retrying or hiding partial failures', async () => {
  const expected = new Error('fixture database failure');
  const db = { async query() { throw expected; } };
  await assert.rejects(() => persistTopicMaterial(db, 1, material()), (error) => error === expected);
  await assert.rejects(() => loadLatestTopicMaterial(db, 1), (error) => error === expected);
});
