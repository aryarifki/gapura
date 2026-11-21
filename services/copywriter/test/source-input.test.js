import test from 'node:test';
import assert from 'node:assert/strict';
import { topicEditorialInput } from '../../common/source-editorial.js';
import { createTopicEditorialInputLoader, resolveTopicEditorialInput } from '../source-input.js';

const url = 'https://publisher.example.org/story';
const material = (overrides = {}) => ({
  version: 1, extraction: { status: 'full', error_code: null }, publisher: 'Media Uji',
  discovery_url: url, article_url: url,
  paragraphs: [
    { id: 'p1', source_url: url, role: 'reporting', text: 'Lembaga melaporkan perubahan kondisi ekonomi pada periode pengamatan terbaru.' },
    { id: 'p2', source_url: url, role: 'reporting', text: 'Data resmi mencatat perkembangan yang berbeda antara sektor usaha dan rumah tangga.' },
    { id: 'p3', source_url: url, role: 'reporting', text: 'Kebijakan ditujukan untuk menjaga akses pembiayaan bagi pelaku usaha produktif.' },
    { id: 'p4', source_url: url, role: 'reporting', text: 'Baca juga: tautan terkait yang tidak termasuk materi berita.' },
  ], ...overrides,
});

test('only substantive distinct article paragraphs become attributed current facts', () => {
  const input = topicEditorialInput(material());
  assert.equal(input.mode, 'current');
  assert.deepEqual(input.facts.map(({ id }) => id), ['p1', 'p2', 'p3']);
  assert.ok(input.facts.every((fact) => fact.source_url === url && fact.source_name === 'Media Uji'));
});

test('summary-only, short or insufficient source material cannot become a news brief', () => {
  for (const candidate of [
    material({ extraction: { status: 'summary_only' } }),
    material({ paragraphs: material().paragraphs.slice(0, 2) }),
    material({ paragraphs: material().paragraphs.map((paragraph) => ({ ...paragraph, text: 'Baca juga: tautan pendek.' })) }),
  ]) assert.throws(() => topicEditorialInput(candidate), /source_material_insufficient/);
});

test('loader runs public-web research for a social-platform discovery link', async () => {
  let readCount = 0;
  const pool = {
    async query() { return { rows: [{ id: 1, title: 'Percakapan sedang trending', url: 'https://bsky.app/profile/public.example/post/1', primary_source: 'Bluesky', summary: 'Percakapan publik membahas suatu isu penting.' }] }; },
  };
  const facts = material().paragraphs.slice(0, 3).map((item, index) => ({ id: `forum${index}`, text: item.text, source_url: item.source_url.replace('publisher.example.org', `community${index}.example.org`), source_name: 'Forum publik' }));
  const loader = createTopicEditorialInputLoader({ pool, reader: { async read() { readCount++; return {}; } },
    researcher: async (topic, { reader: actualReader }) => {
      assert.equal(topic.url, 'https://bsky.app/profile/public.example/post/1');
      assert.ok(actualReader);
      return { version: 1, mode: 'current', facts };
    } });
  const result = await loader.load(1);
  assert.equal(result.mode, 'current');
  assert.equal(result.facts.length, 3);
  assert.equal(readCount, 0);
});

test('loader reuses a completed research result and coalesces concurrent requests', async () => {
  let queryCount = 0;
  let researchCount = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pool = {
    async query() {
      queryCount++;
      return { rows: [{ id: 2, title: 'Topik layanan publik', url, primary_source: 'Media Uji', summary: 'Konteks layanan.' }] };
    },
  };
  const facts = material().paragraphs.slice(0, 3).map(({ id, text, source_url }) => ({ id, text, source_url, source_name: 'Media Uji' }));
  const loader = createTopicEditorialInputLoader({ pool, researcher: async () => {
    researchCount++;
    await gate;
    return { version: 1, mode: 'current', facts };
  } });
  const first = loader.load(2);
  const second = loader.load(2);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(left, right);
  assert.equal(queryCount, 1);
  assert.equal(researchCount, 1);
  assert.deepEqual(loader.getDocuments(2), undefined);
  const cached = await loader.load(2);
  assert.deepEqual(cached, left);
  assert.equal(queryCount, 1);
  assert.equal(researchCount, 1);
});

test('refresh bypasses the editorial input cache and starts a new research request', async () => {
  let researchCount = 0;
  let revision = 0;
  const pool = { async query() { return { rows: [{ id: 3, title: 'Topik layanan publik', url, primary_source: 'Media Uji' }] }; } };
  const loader = createTopicEditorialInputLoader({ pool, researcher: async () => {
    researchCount++;
    return { version: 1, mode: 'current', facts: material().paragraphs.slice(0, 3).map(({ id, text, source_url }) => ({
      id, text, source_url, source_name: 'Media Uji', revision: ++revision,
    })) };
  } });
  const first = await loader.load(3);
  const second = await loader.load(3, { refresh: true });
  assert.equal(researchCount, 2);
  assert.notDeepEqual(second, first);
});

test('seeded research is never reused as the unseeded topic cache', async () => {
  let calls = 0;
  const pool = { async query() { return { rows: [{ id: 4, title: 'Topik layanan publik', url, primary_source: 'Media Uji' }] }; } };
  const loader = createTopicEditorialInputLoader({ pool, researcher: async (_topic, { seedFacts }) => {
    calls++;
    return { version: 1, mode: 'current', facts: material().paragraphs.slice(0, 3).map(({ id, text, source_url }) => ({
      id, text, source_url, source_name: seedFacts.length ? 'Seeded' : 'Researched',
    })) };
  } });
  const seeded = await loader.load(4, { seedFacts: [{ id: 'manual', text: 'Manual fact' }] });
  const normal = await loader.load(4);
  assert.equal(calls, 2);
  assert.equal(seeded.facts[0].source_name, 'Seeded');
  assert.equal(normal.facts[0].source_name, 'Researched');
});

test('omitting the empty UI explainer selection loads topic-derived news input', async () => {
  const loader = { async load(topicId) { assert.equal(topicId, 1); return topicEditorialInput(material()); } };
  const result = await resolveTopicEditorialInput(loader, 1);
  assert.equal(result.mode, 'current');
  assert.equal(result.facts.length, 3);
});

test('default writer researches cross-domain public sources instead of requiring an article-host allowlist', async () => {
  const pool = { async query(sql) {
    assert.match(sql, /SELECT id,title,url,primary_source,summary,desk,normalized_title FROM topics/u);
    return { rows: [{ id: 12, title: 'Topik populer dari sosial', url: 'https://bsky.app/profile/public.example/post/1', primary_source: 'Bluesky' }] };
  } };
  const facts = material().paragraphs.slice(0, 3).map(({ id, text, source_url }, index) => ({ id: `pub${index}`, text, source_url: source_url.replace('publisher.example.org', `source${index}.example.org`), source_name: 'Forum Publik' }));
  const loader = createTopicEditorialInputLoader({ pool, reader: { read: async () => { throw new Error('Do not reread discovery publisher.'); } },
    researcher: async (topic, options) => {
      assert.equal(topic.id, 12);
      assert.ok(options.reader);
      return { version: 1, mode: 'current', facts };
    } });
  const input = await loader.load(12);
  assert.equal(input.mode, 'current');
  assert.equal(input.facts[0].source_name, 'Forum Publik');
});
