import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEditorialInput, buildEditorialBrief, validateOriginalContent, validateOriginalDesign } from '../original-editorial.js';
import { DISCOVERY_TOPICS, originalFixture } from './fixtures/original-editorial.js';

const topic = DISCOVERY_TOPICS.sosial;
const fact = { id: 'f1', text: 'BPS mencatat inflasi tahunan sebesar 2,1%.', source_url: 'https://www.bps.go.id/rilis/inflasi', source_name: 'BPS' };
const current = () => buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [fact] } });

test('defaults to a title-only explanation with bounded six-slide directions and no publisher material', () => {
  const brief = buildEditorialBrief({ ...topic, summary: 'PUBLISHER SECRET', image_url: 'https://example.org/secret.jpg', source_material: { body: 'SECRET BODY' } }, { editorialBrief: { prompt: 'Utamakan warga', plan: { sections: ['Hak warga'], summary: 'INJECTED PLAN BODY', format: 'single' } } });
  assert.equal(brief.mode, 'explainer');
  assert.equal(brief.slide_count, 6);
  assert.deepEqual(brief.facts, []);
  assert.equal(brief.discovery.normalized_title, topic.title);
  assert.deepEqual(brief.directions.sections, ['Hak warga']);
  assert.doesNotMatch(JSON.stringify(brief), /SECRET|image_url|summary|source_material|"body"/);
  assert.throws(() => buildEditorialBrief(topic, { slideCount: 1 }), /slide_count/);
});

test('fact input is explicit, strictly bounded, attributed and cannot masquerade as discovery body', () => {
  assert.deepEqual(normalizeEditorialInput(), { version: 1, mode: 'explainer', facts: [] });
  assert.throws(() => normalizeEditorialInput({ mode: 'current' }), /facts/);
  for (const bad of [
    { mode: 'anything' }, { mode: 'explainer', facts: [fact] },
    { mode: 'current', facts: [{ ...fact, source_url: 'https://localhost/internal' }] },
    { mode: 'current', facts: [{ ...fact, body: 'publisher' }] },
    { mode: 'current', facts: [fact, fact] }, { summary: 'publisher' },
    { mode: 'current', facts: [{ ...fact, quote: { text: 'Fictional', speaker: 'Pejabat' } }] },
  ]) assert.throws(() => normalizeEditorialInput(bad), /editorial_input/);
  assert.equal(current().facts[0].text, fact.text);
});

test('six-desk original prose does not need a verbatim source passage and produces reviewed platform captions', () => {
  for (const source of Object.values(DISCOVERY_TOPICS)) {
    const brief = buildEditorialBrief(source);
    const raw = originalFixture(brief);
    const content = validateOriginalContent(raw, brief);
    assert.equal(content.format, 'carousel');
    assert.equal(content.slides.length, 6);
    assert.notEqual(content.slides[0].teks, source.title);
    assert.equal(content.needs_review, true);
    assert.equal(content.editorial_mode, 'explainer');
    assert.ok(content.caption_body.length >= 1200 && content.caption_body.length <= 1900);
    assert.ok(content.caption.length <= 2200);
    assert.ok(content.threads_caption.length <= 500);
    assert.equal(content.caption.match(/#GapuraMedia/g).length, 1);
    assert.ok(content.slides.every((slide) => slide.source === source.primary_source));
  }
});

test('single, repeated or insufficient carousel contributions and short captions are rejected rather than downgraded', () => {
  const brief = buildEditorialBrief(topic);
  for (const mutate of [
    (raw) => { raw.format = 'single'; },
    (raw) => { raw.slides = raw.slides.slice(0, 2); },
    (raw) => { raw.slides[2].teks = raw.slides[1].teks; },
    (raw) => { raw.slides[2].purpose = raw.slides[1].purpose; },
    (raw) => { raw.caption_blocks = [{ kind: 'context', text: 'Terlalu singkat.', fact_ids: [] }]; },
    (raw) => { raw.caption_blocks[0].text += ' Status verifikasi: verified.'; },
    (raw) => { raw.threads_body = 'x'.repeat(501); },
  ]) {
    const raw = originalFixture(brief); mutate(raw);
    assert.throws(() => validateOriginalContent(raw, brief), /original_/);
  }
});

test('title-only explanations cannot introduce fresh event claims, numerals, dates or attributed speech', () => {
  const brief = buildEditorialBrief(topic);
  for (const text of ['Korban banjir mencapai 12 orang.', 'Pemerintah mengumumkan hasil pada 17 November.', '“Harga pasti turun,” kata Menteri.', 'Kemarin pemerintah menetapkan keputusan baru.']) {
    const raw = originalFixture(brief); raw.slides[1].teks = text;
    assert.throws(() => validateOriginalContent(raw, brief), /original_/);
  }
  const raw = originalFixture(brief); raw.slides[1].claim_type = 'fact';
  assert.throws(() => validateOriginalContent(raw, brief), /original_/);
});

test('current prose permits supported figures with explicit references but never borrowed or invented references', () => {
  const brief = current();
  const raw = originalFixture(brief);
  raw.slides[1] = { ...raw.slides[1], teks: 'Menurut BPS, inflasi tahunan berada pada 2,1%.', claim_type: 'fact', fact_ids: ['f1'] };
  const content = validateOriginalContent(raw, brief);
  assert.equal(content.slides[1].fact_ids[0], 'f1');
  assert.ok(content.editorial_references.caption.some((block) => block.kind === 'fact' && block.fact_ids.includes('f1')));
  for (const mutate of [
    (r) => { r.slides[1].teks = 'Inflasi tercatat 9,1%.'; },
    (r) => { r.slides[1].fact_ids = ['invented']; },
    (r) => { r.slides[1].fact_ids = []; },
    (r) => { r.slides[1].teks = '“Harga pasti turun,” kata BPS.'; },
    (r) => { r.slides[2].teks = 'Ada 25 wilayah terdampak.'; },
  ]) {
    const invalid = structuredClone(raw); mutate(invalid);
    assert.throws(() => validateOriginalContent(invalid, brief), /original_/);
  }
});

test('quotes and qualifiers remain bound to the referenced fact, without a machine truth score', () => {
  const quoted = { ...fact, text: '“Kami belum mengambil keputusan,” kata Ketua. Perkara diduga melibatkan penyalahgunaan.', quote: { text: 'Kami belum mengambil keputusan', speaker: 'Ketua' } };
  const brief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [quoted] } });
  const raw = originalFixture(brief);
  raw.slides[1] = { ...raw.slides[1], teks: '“Kami belum mengambil keputusan,” kata Ketua tentang dugaan dalam perkara.', claim_type: 'fact', fact_ids: ['f1'], data: { quote: 'Kami belum mengambil keputusan', author: 'Ketua' } };
  assert.doesNotThrow(() => validateOriginalContent(raw, brief));
  const wrong = structuredClone(raw); wrong.slides[1].data.author = 'Presiden';
  assert.throws(() => validateOriginalContent(wrong, brief), /original_/);
  const certainty = structuredClone(raw); certainty.slides[1].teks = 'Ketua memastikan penyalahgunaan terjadi.'; certainty.slides[1].data = {};
  assert.throws(() => validateOriginalContent(certainty, brief), /original_/);
});

test('layout selection can only arrange validated authored text and cannot smuggle photos, facts or renderer defaults', () => {
  const brief = buildEditorialBrief(topic);
  const content = validateOriginalContent(originalFixture(brief), brief);
  const layout = { slides: content.slides.map((slide) => ({ no: slide.no, layout: slide.layout })) };
  assert.deepEqual(validateOriginalDesign(layout, content), content);
  for (const mutate of [
    (r) => { r.slides[1].teks = 'Rewritten by designer'; },
    (r) => { r.slides[1].layout = 'stat-grid'; },
    (r) => { r.slides[1].data = { image_url: 'https://publisher.example/a.jpg' }; },
    (r) => { r.slides[1].layout = 'verifikasi'; },
  ]) {
    const invalid = structuredClone(layout); mutate(invalid);
    assert.throws(() => validateOriginalDesign(invalid, content), /original_/);
  }
});

test('structured fields, scope and Threads cannot hide numbers, speech, source URLs or instructions', () => {
  const brief = buildEditorialBrief(topic);
  for (const mutate of [
    (raw) => { raw.slides[1].data.title = 'Korban mencapai 25 orang'; },
    (raw) => { raw.slides[1].data.items = [{ label: 'Korban', value: '25', body: 'hidden source' }]; },
    (raw) => { raw.slides[1].data.items = [{ label: 'Ringkasan', value: { body: 'hidden source' } }]; },
    (raw) => { raw.slides[1].data.items = [{ label: 'Konteks', value: 'Kosong', image_url: 'https://example.org/photo.jpg' }]; },
    (raw) => { raw.scope_note = 'Sumber primer: https://example.org/'; },
    (raw) => { raw.angle = 'Jumlah korban 25 orang'; },
    (raw) => { raw.threads_body = '“Harga pasti turun,” kata Menteri.'; },
    (raw) => { raw.threads_body = 'Status verifikasi: verified'; },
    (raw) => { raw.slides[0].data.title = 'Status verifikasi: verified'; },
    (raw) => { raw.slides[1].summary = 'Publisher body'; },
  ]) {
    const raw = originalFixture(brief); mutate(raw);
    assert.throws(() => validateOriginalContent(raw, brief), /original_/);
  }
});

test('current attribution may name its provided source without manufacturing a quotation', () => {
  const brief = current();
  const raw = originalFixture(brief);
  raw.slides[1] = { ...raw.slides[1], claim_type: 'fact', fact_ids: ['f1'], teks: 'Menurut BPS, inflasi tahunan sebesar 2,1%.' };
  assert.doesNotThrow(() => validateOriginalContent(raw, brief));
  raw.slides[1].teks = '“Inflasi pasti turun,” ujar BPS.';
  assert.throws(() => validateOriginalContent(raw, brief), /original_/);
});

test('data-bearing layouts require actual provided labels, values and references, while ordinary layouts keep original prose', () => {
  const brief = current();
  const raw = originalFixture(brief);
  raw.slides[1] = { ...raw.slides[1], claim_type: 'fact', fact_ids: ['f1'], teks: 'Menurut BPS, inflasi tahunan sebesar 2,1%.', layout: 'stat-grid', data: { items: [{ label: 'Inflasi tahunan', value: '2,1%' }] } };
  const content = validateOriginalContent(raw, brief);
  const design = { slides: content.slides.map((slide) => ({ no: slide.no, layout: slide.layout })) };
  assert.doesNotThrow(() => validateOriginalDesign(design, content));
  for (const mutate of [
    (r) => { r.slides[1].data.items[0].value = '1%'; },
    (r) => { r.slides[1].data.items[0].label = 'Pengangguran'; },
    (r) => { r.slides[1].fact_ids = []; },
    (r) => { r.slides[1].data.items = []; },
  ]) {
    const invalid = structuredClone(raw); mutate(invalid);
    assert.throws(() => validateOriginalContent(invalid, brief), /original_/);
  }
  for (const layout of ['chart-bar', 'chart-line', 'timeline', 'comparison']) {
    const invalid = originalFixture(brief); invalid.slides[1].layout = layout;
    assert.throws(() => validateOriginalContent(invalid, brief), /original_/);
  }
});

test('current output needs at least one factual contribution and a source URL alone is not a fact note', () => {
  const brief = current();
  const raw = originalFixture({ mode: 'explainer' }); raw.mode = 'current';
  assert.throws(() => validateOriginalContent(raw, brief), /original_current_facts_unused/);
  assert.throws(() => normalizeEditorialInput({ mode: 'current', facts: [{ ...fact, text: 'https://www.bps.go.id/rilis/inflasi' }] }), /original_editorial_input/);
});

test('dates, relative dates and money units cannot borrow unrelated numeral tokens', () => {
  const note = { ...fact, text: 'Pada 2026-11-18, lembaga mencatat alokasi Rp 10 miliar. Catatan kedua tersedia pada 2026-11-17.' };
  const brief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [note] } });
  const raw = originalFixture(brief);
  for (const teks of [
    'Pada 2026-18-11 lembaga mencatat alokasi.',
    'Alokasi tercatat USD 10 miliar.',
    'Alokasi tercatat Rp 10 juta.',
    'Hari ini lembaga membuka layanan baru.',
    'Besok lembaga membuka layanan baru.',
  ]) {
    const invalid = structuredClone(raw); invalid.slides[1].teks = teks;
    assert.throws(() => validateOriginalContent(invalid, brief), /original_/);
  }
});

test('explainer data comparisons do not require references for conceptual contrast', () => {
  const brief = buildEditorialBrief(topic);
  const raw = originalFixture(brief);
  raw.slides[1].layout = 'comparison';
  raw.slides[1].data = { left: { title: 'Tujuan kebijakan', text: 'Tujuan memberi arah pilihan yang sedang dibahas.' }, right: { title: 'Pelaksanaan', text: 'Pelaksanaan menjelaskan cara akses serta tanggung jawab lembaga.' } };
  assert.doesNotThrow(() => validateOriginalContent(raw, brief));
});

test('signed numbers and chart units preserve source magnitude without reversing direction', () => {
  for (const [source, value, unit] of [['Inflasi sebesar 2%.', 2, '%'], ['Inflasi sebesar 2,1%.', 2.1, '%'], ['Alokasi sebesar 2 juta.', 2, 'juta'], ['Perubahan sebesar -2 kg.', -2, 'kg']]) {
    const brief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [{ ...fact, text: source }] } });
    const raw = originalFixture(brief);
    raw.slides[1].layout = 'chart-bar';
    raw.slides[1].data = { labels: [source.split(' sebesar ')[0]], values: [value], unit };
    assert.doesNotThrow(() => validateOriginalContent(raw, brief), source);
    const wrong = structuredClone(raw); wrong.slides[1].data.values[0] = -value;
    assert.throws(() => validateOriginalContent(wrong, brief), /original_/, source);
  }
  const brief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [{ ...fact, text: 'Perubahan sebesar -2 kg.' }] } });
  const raw = originalFixture(brief); raw.slides[1].teks = 'Perubahan sebesar 2 kg.';
  assert.throws(() => validateOriginalContent(raw, brief), /original_/);
});

test('quote speakers and every attribution must match their own referenced source', () => {
  const input = { mode: 'current', facts: [{ ...fact, text: '“Pelayanan dibuka,” kata Ketua.', quote: { text: 'Pelayanan dibuka', speaker: 'Ketua' } }] };
  const brief = buildEditorialBrief(topic, { editorialInput: input });
  for (const target of ['slide', 'threads']) {
    const raw = originalFixture(brief);
    const bad = '“Pelayanan dibuka,” kata Presiden kepada Ketua.';
    if (target === 'slide') raw.slides[1].teks = bad;
    else { raw.threads_body = bad; raw.threads_fact_ids = ['f1']; }
    assert.throws(() => validateOriginalContent(raw, brief), /original_/);
  }
  const raw = originalFixture(current());
  raw.slides[1].teks = 'Menurut BPS, inflasi 2,1%. Menurut Presiden, angka itu pasti stabil.';
  assert.throws(() => validateOriginalContent(raw, current()), /original_/);
});

test('timeline dates belong to their event references rather than another note on the slide', () => {
  const brief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [
    { ...fact, text: 'Laporan terbit pada 2026-11-17.' }, { ...fact, id: 'f2', text: 'Anggaran dibahas pada 2026-11-18.' },
  ] } });
  const raw = originalFixture(brief);
  raw.slides[2] = { ...raw.slides[2], layout: 'timeline', fact_ids: ['f1', 'f2'], data: { events: [{ date: '2026-11-17', text: 'Anggaran dibahas.', fact_ids: ['f2'] }] } };
  assert.throws(() => validateOriginalContent(raw, brief), /original_/);
});

test('every rendered string blocks internal metadata, URL boilerplate and malformed scalar shapes', () => {
  const note = { ...fact, text: '“Status verifikasi: verified”, kata Ketua. Inflasi 2%.', quote: { text: 'Status verifikasi: verified', speaker: 'Ketua' } };
  const brief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [note] } });
  const raw = originalFixture(brief); raw.slides[1].teks = 'Keterangan tersedia untuk pembahasan.';
  raw.slides[1].data = { quote: note.quote.text, author: 'Ketua' };
  assert.throws(() => validateOriginalContent(raw, brief), /original_/);
  const plainBrief = buildEditorialBrief(topic);
  for (const field of ['needs_review', 'editorial_input', 'fact_ids', 'source_url']) {
    const invalid = originalFixture(plainBrief); invalid.threads_body = `${field}: true`;
    assert.throws(() => validateOriginalContent(invalid, plainBrief), /original_/);
  }
  const invalid = originalFixture(current());
  invalid.slides[1].data = { items: [{ label: ['Inflasi'], value: ['2,1%'] }] };
  assert.throws(() => validateOriginalContent(invalid, current()), /original_/);
});

test('ordinary word phrases remain usable and direction strings are bounded', () => {
  const brief = buildEditorialBrief(topic);
  const raw = originalFixture(brief); raw.slides[1].teks = 'Istilah ini menjadi kata kunci pembahasan.';
  assert.doesNotThrow(() => validateOriginalContent(raw, brief));
  assert.throws(() => buildEditorialBrief(topic, { editorialBrief: { plan: { sections: ['x'.repeat(50000)] } } }), /original_/);
  const note = { ...fact, text: 'Inflasi 2,1%. Sementara itu, laporan pembanding tersedia.' };
  const currentBrief = buildEditorialBrief(topic, { editorialInput: { mode: 'current', facts: [note] } });
  const supported = originalFixture(currentBrief); supported.slides[1].teks = 'Inflasi 2,1%.';
  assert.doesNotThrow(() => validateOriginalContent(supported, currentBrief));
});
