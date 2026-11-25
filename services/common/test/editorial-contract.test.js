import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_POLICY,
  materialSufficiency,
  normalizeCategory,
  normalizeHeadline,
  validateMediaAsset,
  validateNewsCarousel,
  validatePublicCaption,
  assemblePublicCaption,
} from '../editorial-contract.js';

const paragraphs = [
  { id: 'p1', text: 'Pemerintah menetapkan kebijakan baru pada Senin setelah rapat resmi.', source_url: 'https://example.org/a', role: 'official_statement' },
  { id: 'p2', text: 'Kebijakan itu berlaku untuk layanan publik di tiga wilayah mulai bulan depan.', source_url: 'https://example.org/a', role: 'reporting' },
  { id: 'p3', text: 'Pejabat terkait menjelaskan tahapan pelaksanaan dan jadwal evaluasi.', source_url: 'https://example.org/a', role: 'official_statement' },
];

const asset = {
  id: 'asset-1', url: 'https://img.antaranews.com/fixture.jpg', source_url: 'https://example.org/a',
  credit: 'Antara', rights_basis: 'editor_approved', status: 'downloaded', mime: 'image/jpeg', width: 1200, height: 800,
  rights_reference: 'https://example.org/usage-permission', rights_approved_by: 'fixture-editor', rights_approved_at: '2026-11-17T00:00:00Z',
  local_path: 'media/asset-1.jpg', sha256: 'a'.repeat(64),
};

function carousel(overrides = {}) {
  return {
    format: 'carousel',
    media: { cover_asset_id: 'asset-1', assets: [asset] },
    material: { version: 1, paragraphs },
    slides: [
      { no: 1, role: 'cover', layout: 'cover-focus', teks: 'Pemerintah menetapkan kebijakan baru', evidence_ids: ['p1'], data: { asset_id: 'asset-1' } },
      { no: 2, role: 'explanation', layout: 'big-statement', teks: 'Kebijakan berlaku untuk layanan publik di tiga wilayah.', evidence_ids: ['p2'], data: {} },
      { no: 3, role: 'official_statement', layout: 'big-statement', teks: 'Pejabat terkait menjelaskan tahapan pelaksanaan.', evidence_ids: ['p3'], data: {} },
      { no: 4, role: 'chronology', layout: 'big-statement', teks: 'Tahapan berjalan mulai bulan depan.', evidence_ids: ['p2', 'p3'], data: {} },
      { no: 5, role: 'public_impact', layout: 'big-statement', teks: 'Dampak kebijakan terlihat pada layanan publik.', evidence_ids: ['p2'], data: {} },
      { no: 6, role: 'close', layout: 'big-statement', teks: 'Jadwal evaluasi menjadi tahap berikutnya.', evidence_ids: ['p3'], data: {} },
    ],
    caption: 'Pemerintah menetapkan kebijakan baru setelah rapat resmi. Kebijakan ini berlaku untuk layanan publik di tiga wilayah mulai bulan depan. Pejabat terkait menjelaskan tahapan pelaksanaan dan jadwal evaluasi.\n\nPerubahan ini penting karena masyarakat di wilayah terdampak perlu memahami kapan aturan mulai berlaku dan apa yang berubah dalam layanan sehari-hari.',
    hashtags: ['#GapuraMedia', '#Politik'],
    caption_evidence_ids: ['p1', 'p2', 'p3'],
    ...overrides,
  };
}

test('policy defines six desks and carousel-first newsroom defaults', () => {
  assert.deepEqual(EDITORIAL_CATEGORIES, ['politik', 'sosial', 'hukum', 'lingkungan', 'ekonomi', 'bursa']);
  assert.equal(EDITORIAL_POLICY.carousel.default_slides, 6);
  assert.deepEqual([EDITORIAL_POLICY.carousel.min_slides, EDITORIAL_POLICY.carousel.max_slides], [3, 9]);
  assert.equal(EDITORIAL_POLICY.media.require_cover_visual, true);
  assert.equal(EDITORIAL_POLICY.media.default_kind, 'ai_generated');
  assert.equal(EDITORIAL_POLICY.caption.max_chars, 2200);
});

test('AI visual contract has local provenance and disclosure without pretending to be a source photograph', () => {
  const generated = { id: 'ad3cc71e-46d3-4db6-bf20-8c9eb066491c', kind: 'ai_generated', status: 'ready', credit: 'Gapura Media',
    provider: 'gemini', model: 'fixture-image', prompt: 'Ilustrasi editorial konseptual tentang layanan warga',
    generated_at: '2026-11-17T00:00:00Z', rights_basis: 'ai_generated', rights_reference: 'https://ai.google.dev/gemini-api/terms',
    disclosure: 'Ilustrasi AI · Gapura Media', disclosure_version: 1, local_path: 'media/ad3cc71e-46d3-4db6-bf20-8c9eb066491c.png',
    mime: 'image/png', width: 640, height: 480, sha256: 'b'.repeat(64) };
  assert.deepEqual(validateMediaAsset(generated), { valid: true, reason: null });
  for (const mutation of [
    { prompt: '' }, { provider: '' }, { model: '' }, { generated_at: null }, { rights_reference: '' },
    { disclosure: 'Foto Gapura' }, { disclosure_version: 0 }, { rights_basis: 'owned' }, { local_path: '../escape.png' }, { id: '' },
  ]) assert.equal(validateMediaAsset({ ...generated, ...mutation }).valid, false, JSON.stringify(mutation));
  const draft = carousel();
  draft.media = { cover_asset_id: generated.id, assets: [generated] };
  draft.slides[0].data.asset_id = generated.id;
  assert.equal(validateNewsCarousel(draft).valid, true);
});

test('normalizes only known transport noise and preserves meaningful punctuation', () => {
  const raw = '[Google News: X query fallback] DPR Membahas RUU Perlindungan Data - CNN Indonesia';
  assert.equal(normalizeHeadline(raw, { publisher: 'CNN Indonesia' }), 'DPR Membahas RUU Perlindungan Data');
  assert.equal(normalizeHeadline('[X/RSSHub] Warga menolak tambang - Antara', { publisher: 'Antara' }), 'Warga menolak tambang');
  assert.equal(normalizeHeadline('DPR - RI membahas kebijakan — tahap awal', { publisher: 'CNN Indonesia' }), 'DPR - RI membahas kebijakan — tahap awal');
  assert.equal(normalizeHeadline(normalizeHeadline(raw, { publisher: 'CNN Indonesia' }), { publisher: 'CNN Indonesia' }), 'DPR Membahas RUU Perlindungan Data');
});

test('normalizes desk aliases without creating a truth verdict', () => {
  assert.equal(normalizeCategory('politik nasional'), 'politik');
  assert.equal(normalizeCategory('masyarakat'), 'sosial');
  assert.equal(normalizeCategory('lingkungan hidup'), 'lingkungan');
  assert.equal(normalizeCategory('pasar modal'), 'bursa');
  assert.equal(normalizeCategory('unknown'), null);
  assert.equal(normalizeCategory('politikawan'), null);
  assert.equal(normalizeCategory('ekonomis'), null);
});

test('material sufficiency requires three distinct supported contributions with attribution', () => {
  const result = materialSufficiency({ version: 1, paragraphs });
  assert.deepEqual(result, { sufficient: true, contributions: 3, reason: null });
  assert.equal(materialSufficiency({ version: 1, paragraphs: paragraphs.slice(0, 2) }).reason, 'source_content_incomplete');
  assert.equal(materialSufficiency({ version: 1, paragraphs: [{ ...paragraphs[0], source_url: '' }, paragraphs[1], paragraphs[2]] }).sufficient, false);
  assert.equal(materialSufficiency({ version: 1, paragraphs: paragraphs.map((paragraph) => ({ ...paragraph, id: '' })) }).sufficient, false);
});

test('media policy requires a selected downloaded raster and an explicit usage basis', () => {
  assert.deepEqual(validateMediaAsset(asset), { valid: true, reason: null });
  for (const invalid of [
    { ...asset, rights_basis: 'unknown' },
    { ...asset, credit: '' },
    { ...asset, url: 'http://img.antaranews.com/fixture.jpg' },
    { ...asset, mime: 'image/svg+xml' },
    { ...asset, width: 100, height: 100 },
  ]) assert.equal(validateMediaAsset(invalid).valid, false);
});

test('news output requires a meaningful carousel and a cover asset', () => {
  assert.deepEqual(validateNewsCarousel(carousel()), { valid: true, reason: null });
  assert.equal(validateNewsCarousel(carousel({ format: 'single' })).reason, 'carousel_required');
  assert.equal(validateNewsCarousel(carousel({ slides: carousel().slides.slice(0, 2) })).reason, 'carousel_slide_count');
  assert.equal(validateNewsCarousel(carousel({ media: { assets: [asset] } })).reason, 'cover_photo_required');
  assert.equal(validateNewsCarousel(carousel({ slides: carousel().slides.map((slide, i) => i === 5 ? { ...slide, teks: carousel().slides[1].teks } : slide) })).reason, 'duplicate_slide_content');
  assert.equal(validateNewsCarousel(carousel({ slides: carousel().slides.map((slide, i) => i === 1 ? { ...slide, evidence_ids: [] } : slide) })).reason, 'slide_evidence_required');
  assert.equal(validateNewsCarousel(carousel({ material: { paragraphs: paragraphs.slice(0, 2) } })).reason, 'material_evidence_missing');
});

test('public captions reject internal metadata while allowing detailed prose', () => {
  assert.deepEqual(validatePublicCaption(carousel().caption), { valid: true, reason: null });
  for (const marker of ['Sumber primer:', 'Status verifikasi:', 'Belum terverifikasi otomatis', '[Google News: X fallback]']) {
    assert.equal(validatePublicCaption(`${carousel().caption}\n\n${marker}`).valid, false, marker);
  }
  assert.equal(validatePublicCaption('x'.repeat(2201)).reason, 'caption_too_long');
});

test('publisher suffix matching is exact and strips original bytes rather than case-folded length', () => {
  assert.equal(normalizeHeadline('Kerja Sama Antar Daerah - Antara dua pilihan', { publisher: 'Antara' }), 'Kerja Sama Antar Daerah - Antara dua pilihan');
  assert.equal(normalizeHeadline('Kebijakan baru - CNN', { publisher: 'CNN Indonesia' }), 'Kebijakan baru - CNN');
  assert.equal(normalizeHeadline('Kebijakan baru - Antara', { publisher: 'Media Uji', publisherAliases: ['Antara'] }), 'Kebijakan baru');
  const nested = '[X] [Google News: X query fallback] Kebijakan baru - Antara';
  const normalized = normalizeHeadline(nested, { publisher: 'Antara' });
  assert.equal(normalized, 'Kebijakan baru');
  assert.equal(normalizeHeadline(normalized, { publisher: 'Antara' }), normalized);
});

test('unknown or ambiguous category labels do not silently become another desk', () => {
  assert.equal(normalizeCategory('politik dan lingkungan'), null);
  assert.equal(normalizeCategory('harga saham'), null, 'category aliases are labels, not an automatic news classifier');
  assert.equal(normalizeCategory('kehakiman'), null);
  assert.equal(normalizeCategory('nasional'), null, 'national scope is not exclusively politics');
});

test('six-desk synthetic corpus has complete statement/chronology evidence and valid contract shape', () => {
  const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/editorial-stories.json', import.meta.url), 'utf8'));
  assert.equal(corpus.synthetic, true);
  assert.deepEqual(new Set(corpus.stories.map((story) => story.category)), new Set(EDITORIAL_CATEGORIES));
  assert.equal(corpus.stories.length, 6);
  for (const story of corpus.stories) {
    assert.equal(story.synthetic, true);
    assert.equal(story.material.version, 1);
    assert.equal(story.material.paragraphs.length, 6);
    assert.equal(story.draft.caption.length >= EDITORIAL_POLICY.caption.target_min_chars, true);
    assert.equal(story.draft.caption.length <= EDITORIAL_POLICY.caption.target_max_chars, true);
    assert.deepEqual(validateNewsCarousel({ ...story.draft, material: story.material }), { valid: true, reason: null }, story.category);
    assert.equal(validatePublicCaption(story.draft.caption).valid, true);
    const evidence = new Set(story.material.paragraphs.map((paragraph) => paragraph.id));
    assert.equal(story.draft.slides.every((slide) => slide.evidence_ids.every((id) => evidence.has(id))), true);
  }
  const statement = corpus.stories.find((story) => story.draft.style === 'statement');
  const quoteSlide = statement.draft.slides.find((slide) => slide.role === 'official_statement');
  assert.ok(quoteSlide.data.quote && quoteSlide.data.author);
  const chronology = corpus.stories.find((story) => story.draft.style === 'chronology');
  const timeline = chronology.draft.slides.find((slide) => slide.role === 'chronology');
  const dates = timeline.data.events.map((event) => event.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('material IDs and URLs are valid, unique and cannot inflate contributions', () => {
  for (const invalid of [
    { version: 2, paragraphs },
    { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, id: 'same' })) },
    { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, source_url: 'https://localhost/article' })) },
    { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, source_url: 'https://user:pass@example.org/a' })) },
    { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, text: paragraphs[0].text, source_url: `https://example.org/${p.id}` })) },
    { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, text: `  ${paragraphs[0].text.toUpperCase()}  ` })) },
  ]) assert.equal(materialSufficiency(invalid).sufficient, false);
  assert.doesNotThrow(() => materialSufficiency({ version: 1, paragraphs: [null, 1, 'text'] }));
});

test('media metadata requires recorded rights and a stable local raster identity', () => {
  for (const patch of [
    { url: 'https://' }, { url: 'https://localhost/photo.jpg' }, { url: 'https://user:pass@example.org/photo.jpg' },
    { source_url: 'https://192.168.1.2/article' }, { id: '' }, { rights_reference: '' }, { rights_approved_by: '' },
    { rights_approved_at: 'not-a-date' }, { local_path: '' }, { local_path: '../escape.jpg' }, { sha256: '0'.repeat(64) },
  ]) assert.equal(validateMediaAsset({ ...asset, ...patch }).valid, false, JSON.stringify(patch));
  for (const rights_basis of ['owned', 'licensed', 'official_reuse', 'editor_approved']) {
    assert.equal(validateMediaAsset({ ...asset, rights_basis }).valid, true, rights_basis);
  }
});

test('carousel rejects missing/ambiguous evidence, transport labels and empty factual layouts', () => {
  for (const patch of [
    { material: { version: 1, paragraphs: null } },
    { material: { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, id: 'same' })) } },
    { material: { version: 1, paragraphs: paragraphs.map((p) => ({ ...p, text: paragraphs[0].text })) } },
    { media: { cover_asset_id: asset.id, assets: [asset, { ...asset }] } },
    { slides: carousel().slides.map((s, i) => i === 0 ? { ...s, teks: '[X] Headline' } : s) },
    { slides: carousel().slides.map((s, i) => i === 1 ? { ...s, layout: 'stat-grid', data: {} } : s) },
    { slides: carousel().slides.map((s, i) => i === 1 ? { ...s, layout: 'verifikasi' } : s) },
    { caption_evidence_ids: [] }, { caption: 'Status verifikasi: unverified.' },
  ]) assert.equal(validateNewsCarousel(carousel(patch)).valid, false, JSON.stringify(patch));
});

test('quote and timeline fields refer to source passages with exact attribution and ordered dates', () => {
  const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/editorial-stories.json', import.meta.url), 'utf8'));
  const statement = corpus.stories.find((s) => s.draft.style === 'statement');
  const quote = statement.draft.slides.find((s) => s.data.quote);
  const changed = structuredClone(statement.draft);
  changed.slides.find((s) => s.data.quote).data.author = 'Nama tidak ada di sumber';
  assert.equal(validateNewsCarousel({ ...changed, material: statement.material }).reason, 'quote_attribution_invalid');
  assert.ok(statement.material.paragraphs.some((p) => quote.evidence_ids.includes(p.id) && p.text.includes(quote.data.quote) && p.text.includes(quote.data.author)));
  const chronology = corpus.stories.find((s) => s.draft.style === 'chronology');
  const reversed = structuredClone(chronology.draft);
  reversed.slides.find((s) => s.layout === 'timeline').data.events.reverse();
  assert.equal(validateNewsCarousel({ ...reversed, material: chronology.material }).reason, 'timeline_invalid');
});

test('caption assembler handles tags once and enforces the final platform payload limit', () => {
  const text = assemblePublicCaption('Isi berita yang diatribusikan dengan jelas.', ['#GapuraMedia', '#Politik', '#gapuramedia']);
  assert.equal(text, 'Isi berita yang diatribusikan dengan jelas.\n\n#GapuraMedia #Politik');
  assert.throws(() => assemblePublicCaption('Isi #GapuraMedia di body', ['#GapuraMedia']), /caption_hashtags_in_body/);
  assert.throws(() => assemblePublicCaption('x'.repeat(2190), ['#GapuraMedia']), /caption_too_long/);
  assert.throws(() => assemblePublicCaption('x'.repeat(501), [], { platform: 'threads' }), /caption_too_long/);
  assert.throws(() => assemblePublicCaption('Berita', ['not-a-hashtag']), /hashtags_invalid/);
  const maxTags = Array.from({ length: 30 }, (_, i) => `#Tag${i + 1}`);
  assert.ok(assemblePublicCaption('Berita', maxTags).includes('#Tag30'));
  assert.throws(() => assemblePublicCaption('Berita', [...maxTags, '#Tag31']), /hashtags_invalid/);
  assert.equal(validatePublicCaption('Isi\n\n[X/RSSHub] label').valid, false);
  assert.equal(validatePublicCaption('Isi\n\n[X] label').valid, false);
});

test('carousel handles malformed JSON fields without exceptions and rejects hidden layout boilerplate', () => {
  for (const mutation of [
    (draft) => { draft.slides[1].data = []; },
    (draft) => { draft.slides[1].data = 'invalid'; },
    (draft) => { draft.slides[1].data = { title: 'Status verifikasi: unverified' }; },
    (draft) => { draft.slides[1].data = { disclaimer: 'Jangan jadikan dasar keputusan sebelum ada konfirmasi redaksi' }; },
    (draft) => { draft.media.assets.push(null); },
    (draft) => { draft.media.assets = {}; },
  ]) {
    const draft = carousel();
    mutation(draft);
    assert.doesNotThrow(() => validateNewsCarousel(draft));
    assert.equal(validateNewsCarousel(draft).valid, false);
  }
});

test('untrusted JSON labels and timeline dates fail structurally without coercion exceptions', () => {
  for (const value of [null, 42, ['politik'], { toString: null }, { category: 'politik' }]) {
    assert.doesNotThrow(() => normalizeCategory(value));
    assert.equal(normalizeCategory(value), null);
  }
  const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/editorial-stories.json', import.meta.url), 'utf8'));
  const story = corpus.stories.find((item) => item.draft.style === 'chronology');
  for (const value of [{ toString: null }, ['2031-06-10'], null, 20310610]) {
    const draft = structuredClone(story.draft);
    draft.slides.find((slide) => slide.layout === 'timeline').data.events[0].date = value;
    assert.doesNotThrow(() => validateNewsCarousel({ ...draft, material: story.material }));
    assert.equal(validateNewsCarousel({ ...draft, material: story.material }).reason, 'timeline_invalid');
  }
});

test('factual layout fields cannot use objects, booleans or renderer demonstration defaults', () => {
  for (const value of [{ oops: true }, false, [], null, '', NaN, Infinity]) {
    const draft = carousel();
    draft.slides[1].layout = 'stat-grid';
    draft.slides[1].data = { items: [{ label: 'Jumlah loket', value }] };
    assert.equal(validateNewsCarousel(draft).reason, 'stat_grid_invalid');
  }
  const draft = carousel();
  draft.slides[1].layout = 'regulasi';
  draft.slides[1].data = {};
  assert.equal(validateNewsCarousel(draft).reason, 'regulasi_invalid');
  draft.slides[1].data = { title: 'Aturan layanan' }; // Renderer uses slide.teks as the clause body.
  assert.deepEqual(validateNewsCarousel(draft), { valid: true, reason: null });
});

test('public caption body never duplicates structured hashtags even next to punctuation', () => {
  for (const body of ['Isi berita (#GapuraMedia).', 'Isi berita:«#GapuraMedia»', 'Isi berita—#GapuraMedia', '#GapuraMedia']) {
    assert.throws(() => assemblePublicCaption(body, ['#GapuraMedia']), /caption_hashtags_in_body/);
  }
});

test('recognized repeated publisher suffixes normalize once without changing the news meaning', () => {
  const raw = 'DPR tidak mencabut aturan - Antara - Antara';
  const clean = normalizeHeadline(raw, { publisher: 'Antara' });
  assert.equal(clean, 'DPR tidak mencabut aturan');
  assert.equal(normalizeHeadline(clean, { publisher: 'Antara' }), clean);
  assert.equal(normalizeHeadline('Antara dua opsi - versi awal', { publisher: 'Antara' }), 'Antara dua opsi - versi awal');
});

test('politics example does not invent a Friday deadline absent from its supplied source material', () => {
  const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/editorial-stories.json', import.meta.url), 'utf8'));
  const story = corpus.stories.find((item) => item.category === 'politik');
  assert.equal(story.material.paragraphs.some((paragraph) => /Jumat/u.test(paragraph.text)), false);
  assert.doesNotMatch(story.draft.caption, /setiap Jumat/u);
  assert.match(story.draft.caption, /rekap.*mingguan|rekap.*setiap minggu/u);
});

test('economics caption retains the possibility qualifier used by its source', () => {
  const corpus = JSON.parse(fs.readFileSync(new URL('./fixtures/editorial-stories.json', import.meta.url), 'utf8'));
  const story = corpus.stories.find((item) => item.category === 'ekonomi');
  assert.match(story.material.paragraphs.find((paragraph) => paragraph.id === 'p5').text, /dapat terasa berbeda/u);
  assert.match(story.draft.caption, /Dampak perubahan dapat terasa berbeda/u);
  assert.doesNotMatch(story.draft.caption, /Dampak perubahan akan terasa berbeda/u);
});
