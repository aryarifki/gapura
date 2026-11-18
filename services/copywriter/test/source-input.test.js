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

test('loader applies the domain permission gate before attempting an article read', async () => {
  let readCount = 0;
  const pool = {
    async query() { return { rows: [{ url }] }; },
    async connect() { return { async query(sql) {
      if (/SELECT id FROM topics/u.test(sql)) return { rows: [{ id: 1 }] };
      if (/FROM topic_materials/u.test(sql)) return { rows: [] };
      throw new Error('unexpected query');
    }, release() {} }; },
  };
  const loader = createTopicEditorialInputLoader({ pool, reader: { async read() { readCount++; return {}; } }, allowedHosts: new Set() });
  await assert.rejects(loader.load(1), /source_material_permission_required/);
  assert.equal(readCount, 0);
});

test('omitting the empty UI explainer selection loads topic-derived news input', async () => {
  const loader = { async load(topicId) { assert.equal(topicId, 1); return topicEditorialInput(material()); } };
  const result = await resolveTopicEditorialInput(loader, 1);
  assert.equal(result.mode, 'current');
  assert.equal(result.facts.length, 3);
});
