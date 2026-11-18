import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildEditorialBrief, validateOriginalContent } from '../../common/original-editorial.js';
import { originalFixture, DISCOVERY_TOPICS } from '../../common/test/fixtures/original-editorial.js';

let config = {};
let responses = {};
const calls = [];
mock.module('dotenv', { defaultExport: { config() {} } });
mock.module('pg', { defaultExport: { Pool: class {} } });
mock.module('../../common/llm.js', { namedExports: {
  loadAgentsConfig: () => config,
  loadAgentSkills: () => '',
  callAgentLLM: async (agent, prompt) => {
    calls.push({ agent, prompt });
    if (responses[agent] instanceof Error) throw responses[agent];
    if (responses[agent] !== undefined) return typeof responses[agent] === 'string' ? responses[agent] : JSON.stringify(responses[agent]);
    if (agent === 'copywriter') return JSON.stringify(originalFixture(JSON.parse(prompt.split('ORIGINAL_EDITORIAL_JSON: ')[1])));
    const script = JSON.parse(prompt.split('NASKAH_GAPURA_JSON: ')[1].split('\nKembalikan')[0]);
    return JSON.stringify({ slides: script.slides.map(({ no, layout }) => ({ no, layout })) });
  },
} });
const { buildDeterministicCarouselSlides, buildCarouselSlides } = await import('../copywriter.js');
const { designCarouselContent } = await import('../../designer/designer.js');

const topic = {
  ...DISCOVERY_TOPICS.ekonomi, id: 42,
  summary: 'PUBLISHER_SUMMARY_SENTINEL', content_html: '<p>PUBLISHER_BODY_SENTINEL</p>',
  content_raw: 'PUBLISHER_RAW_SENTINEL', source_material: { body: 'PUBLISHER_MATERIAL_SENTINEL' },
  image_url: 'https://img.antaranews.com/PUBLISHER_PHOTO_SENTINEL.jpg',
};
const forbidden = /PUBLISHER_(?:SUMMARY|BODY|RAW|MATERIAL|PHOTO)_SENTINEL|img\.antaranews/;
const original = (source = topic) => {
  const brief = buildEditorialBrief(source);
  return validateOriginalContent(originalFixture(brief), brief);
};
const layouts = (content) => ({ slides: content.slides.map(({ no, layout }) => ({ no, layout })) });

test.beforeEach((t) => {
  config = {}; responses = {}; calls.length = 0;
  t.mock.method(console, 'warn', () => {});
});

test('the removed deterministic path requires original generation and never copies source passages', () => {
  assert.throws(() => buildDeterministicCarouselSlides(topic), /generation_required/);
});

test('copywriter authors the full six-slide story before designer sees only its validated script', async () => {
  const content = await buildCarouselSlides(topic);
  assert.deepEqual(calls.map(({ agent }) => agent), ['copywriter', 'designer']);
  assert.equal(content.format, 'carousel');
  assert.equal(content.slides.length, 6);
  assert.deepEqual(content.slides.map(({ no }) => no), [1, 2, 3, 4, 5, 6]);
  assert.notEqual(content.slides[0].teks, topic.title);
  assert.equal(content.editorial_mode, 'explainer');
  assert.equal(content.needs_review, true);
  assert.equal(content.disclaimer_type, null);
  assert.ok(content.caption_body.length >= 1200 && content.caption_body.length <= 1900);
  assert.ok(content.caption.length <= 2200);
  assert.ok(content.threads_caption.length <= 500);
  for (const { prompt } of calls) assert.doesNotMatch(prompt, forbidden);
  const brief = JSON.parse(calls[0].prompt.split('ORIGINAL_EDITORIAL_JSON: ')[1]);
  assert.deepEqual(Object.keys(brief).sort(), ['version', 'discovery', 'mode', 'facts', 'directions', 'slide_count'].sort());
  assert.equal(brief.discovery.source_url, topic.url);
  assert.deepEqual(brief.facts, []);
  const script = JSON.parse(calls[1].prompt.split('NASKAH_GAPURA_JSON: ')[1].split('\nKembalikan')[0]);
  assert.equal(script.slides[1].teks, content.slides[1].teks);
  assert.doesNotMatch(JSON.stringify(script), /source_url|source_name|summary|content_html|image_url/);
});

test('empty summaries and a legacy single preference still generate a complete original carousel', async () => {
  const content = await buildCarouselSlides({ ...topic, summary: '', format: 'single' });
  assert.equal(content.format, 'carousel');
  assert.equal(content.slides.length, 6);
  assert.equal(content.needs_review, true);
});

test('editorial input comes only from the explicit curated facts contract and sanitized directions', async () => {
  const editorialInput = { mode: 'current', facts: [{ id: 'f1', text: 'BPS mencatat inflasi tahunan sebesar 2,1%.', source_url: 'https://www.bps.go.id/rilis/inflasi', source_name: 'BPS' }] };
  const editorialBrief = { prompt: 'Jelaskan arti ukuran inflasi', summary: topic.summary, plan: { title: 'Membaca inflasi', angle: 'Makna untuk warga', sections: ['Definisi', 'Batas kesimpulan'], caption_tone: 'jelas', source_material: topic.source_material } };
  responses.copywriter = originalFixture(buildEditorialBrief(topic, { editorialInput, editorialBrief }));
  responses.copywriter.slides[1] = { ...responses.copywriter.slides[1], claim_type: 'fact', fact_ids: ['f1'], teks: 'Inflasi tahunan sebesar 2,1% dicatat BPS sebagai ukuran perubahan harga.' };
  responses.copywriter.caption_blocks[0] = { ...responses.copywriter.caption_blocks[0], kind: 'fact', fact_ids: ['f1'], text: `Inflasi tahunan sebesar 2,1% dicatat BPS. ${responses.copywriter.caption_blocks[0].text}` };
  const content = await buildCarouselSlides(topic, { editorialInput, editorialBrief });
  assert.equal(content.editorial_mode, 'current');
  assert.deepEqual(content.editorial_input.facts, editorialInput.facts);
  assert.deepEqual(content.slides[1].fact_ids, ['f1']);
  assert.match(content.caption_body, /2,1%/);
  const brief = JSON.parse(calls[0].prompt.split('ORIGINAL_EDITORIAL_JSON: ')[1]);
  assert.equal(brief.directions.prompt, editorialBrief.prompt);
  assert.equal(brief.directions.angle, editorialBrief.plan.angle);
  assert.doesNotMatch(JSON.stringify(brief), forbidden);
  assert.doesNotMatch(calls[1].prompt, /BPS mencatat inflasi tahunan sebesar 2,1%/);
});

test('provider and malformed response failures remain visible without a draft source-copy fallback', async () => {
  for (const response of [new Error('offline'), '{broken-json', { caption: topic.summary }, { ...originalFixture(), format: 'single' }]) {
    calls.length = 0;
    responses.copywriter = response;
    await assert.rejects(buildCarouselSlides(topic), /original_generation_failed/);
    assert.deepEqual(calls.map(({ agent }) => agent), ['copywriter']);
    assert.doesNotMatch(calls[0].prompt, forbidden);
  }
});

test('short, oversized and fabricated generated captions are rejected rather than clipped or replaced', async () => {
  for (const mutate of [
    (raw) => { raw.caption_blocks = [{ kind: 'context', text: 'Ringkasan singkat.', fact_ids: [] }]; },
    (raw) => { raw.caption_blocks[0].text = 'Penjelasan umum '.repeat(160); },
    (raw) => { raw.caption_blocks[0] = { kind: 'fact', text: 'BPS memastikan inflasi mencapai 99%.', fact_ids: [] }; },
    (raw) => { raw.threads_body = 'x'.repeat(501); },
  ]) {
    const raw = originalFixture(); mutate(raw); responses.copywriter = raw;
    await assert.rejects(buildCarouselSlides(topic), /original_generation_failed/);
  }
});

test('designer outage preserves already validated authored slides and caption without rereading discovery', async () => {
  responses.designer = new Error('offline');
  const content = await buildCarouselSlides(topic);
  const expected = original();
  assert.deepEqual(content, expected);
  assert.ok(calls.every(({ prompt }) => !forbidden.test(prompt)));
});

test('designer can arrange layouts without changing authored text, evidence, captions or order', async () => {
  const content = original();
  responses.designer = layouts(content);
  responses.designer.slides[1].layout = 'illustration';
  const result = await designCarouselContent(content);
  assert.equal(result.slides[1].layout, 'illustration');
  assert.deepEqual(result.slides.map(({ layout, ...slide }) => slide), content.slides.map(({ layout, ...slide }) => slide));
  assert.equal(result.caption, content.caption);
  assert.equal(result.threads_caption, content.threads_caption);
});

test('designer may select a data layout only from authored validated values and labels', async () => {
  const editorialInput = { mode: 'current', facts: [{ id: 'f1', text: 'BPS mencatat inflasi tahunan sebesar 2,1%.', source_url: 'https://www.bps.go.id/rilis/inflasi', source_name: 'BPS' }] };
  const brief = buildEditorialBrief(topic, { editorialInput });
  const raw = originalFixture(brief);
  raw.slides[1].data = { items: [{ label: 'inflasi tahunan', value: '2,1%' }] };
  const content = validateOriginalContent(raw, brief);
  responses.designer = layouts(content);
  responses.designer.slides[1].layout = 'stat-grid';
  const designed = await designCarouselContent(content);
  assert.equal(designed.slides[1].layout, 'stat-grid');
  assert.deepEqual(designed.slides[1].data.items, raw.slides[1].data.items);
  assert.equal(designed.slides[1].teks, content.slides[1].teks);
  assert.equal(designed.caption, content.caption);
  responses.designer = new Error('offline');
  assert.deepEqual(await designCarouselContent(designed), designed);
});

test('designer text mutations, media injection, missing data and unknown layouts retain the original script', async () => {
  const content = original();
  for (const mutate of [
    (raw) => { raw.slides[1].teks = 'Pejabat menjamin harga stabil.'; },
    (raw) => { raw.slides[1].data = { image_url: topic.image_url }; },
    (raw) => { raw.slides[1].layout = 'unknown'; },
    (raw) => { raw.slides.push({ no: 7, layout: 'big-statement' }); },
    (raw) => { raw.slides[0].layout = 'big-statement'; },
    ...['stat-grid', 'chart-bar', 'chart-line', 'timeline', 'comparison'].map((layout) => (raw) => { raw.slides[1].layout = layout; }),
  ]) {
    const raw = layouts(content); mutate(raw); responses.designer = raw;
    assert.deepEqual(await designCarouselContent(content), content);
  }
});

test('designer refuses raw discovery rows rather than creating a source-based fallback', async () => {
  await assert.rejects(designCarouselContent(topic), /original_script_required/);
  assert.equal(calls.length, 0);
});

test('designer projects the authored script and never sends publisher or pinned media metadata', async () => {
  const content = { ...topic, ...original() };
  content.slides[0].summary = topic.summary;
  content.slides[0].data = { ...content.slides[0].data, image_url: topic.image_url, image_data: 'INLINE_MEDIA_SENTINEL', asset_id: 'LOCAL_ASSET_SENTINEL',
    items: [{ label: 'Ruang baca', value: 'Penjelasan', summary: topic.summary, image_url: topic.image_url }],
    left: { title: 'Pilihan', text: 'Konteks', content_html: topic.content_html },
  };
  await designCarouselContent(content);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agent, 'designer');
  assert.doesNotMatch(calls[0].prompt, forbidden);
  assert.doesNotMatch(calls[0].prompt, /INLINE_MEDIA_SENTINEL|LOCAL_ASSET_SENTINEL/);
});

test('selected local cover stays pinned after validation through normal and failed layout requests', async () => {
  const media = { asset_id: 'aa1cc71e-46d3-4db6-bf20-8c9eb066491c', asset_sha256: 'a'.repeat(64), image_kind: 'ai_generated', disclosure_version: 1 };
  for (const response of [undefined, new Error('offline')]) {
    responses.designer = response;
    const content = await buildCarouselSlides({ ...topic, cover_illustration: { ...media, image_url: topic.image_url, image_data: 'UNTRUSTED_INLINE' } });
    for (const [key, value] of Object.entries(media)) assert.equal(content.slides[0].data[key], value);
    assert.equal(content.slides[0].data.image_url, undefined);
    assert.equal(content.slides[0].data.image_data, undefined);
    for (const { prompt } of calls) {
      assert.doesNotMatch(prompt, forbidden);
      assert.doesNotMatch(prompt, /aa1cc71e-46d3-4db6-bf20-8c9eb066491c|UNTRUSTED_INLINE/);
    }
  }
});

test('all six desks use original prose and human review without inherited financial or legal boilerplate', async () => {
  config = { copywriter: { disclaimer_financial: 'Khusus bursa: bukan rekomendasi investasi.', disclaimer_legal: 'Khusus hukum: bukan nasihat hukum.' } };
  for (const desk of Object.keys(DISCOVERY_TOPICS)) {
    const content = await buildCarouselSlides({ ...topic, ...DISCOVERY_TOPICS[desk] });
    assert.equal(content.format, 'carousel', desk);
    assert.equal(content.slides.length, 6, desk);
    assert.equal(content.needs_review, true, desk);
    assert.equal(content.disclaimer_type, null, desk);
    assert.doesNotMatch(content.caption, /Khusus bursa|Khusus hukum/, desk);
  }
});
