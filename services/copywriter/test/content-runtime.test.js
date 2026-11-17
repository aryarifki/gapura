import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

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
    return JSON.stringify(responses[agent]);
  },
} });
const { buildDeterministicCarouselSlides, buildCarouselSlides } = await import('../copywriter.js');
const { designCarouselContent } = await import('../../designer/designer.js');

const topic = {
  id: 42, title: 'BPS merilis data inflasi Oktober',
  summary: 'Inflasi tahunan Oktober tercatat 2,1%. Harga pangan naik 1,2% pada periode yang sama. BPS mencatat kelompok transportasi tidak mengalami perubahan harga.',
  primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/inflasi?bulan=oktober',
};
const verification = { status: 'verified', confidence: 90 };
test.beforeEach(() => { config = {}; responses = {}; calls.length = 0; });

test('deterministic single respects the requested format even for complex source material', () => {
  const content = buildDeterministicCarouselSlides({ ...topic, format: 'single', title: 'Regulasi dan mekanisme baru' }, verification);
  assert.equal(content.format, 'single');
  assert.equal(content.slides.length, 1);
  assert.ok(!Array.isArray(content));
  assert.equal(content.verification_status, 'verified');
});

test('carousel uses distinct source passages without forced comparison, author quotes or closing filler', () => {
  const content = buildDeterministicCarouselSlides({ ...topic, format: 'carousel' }, verification);
  assert.equal(content.format, 'carousel');
  assert.equal(content.slides.length, 4);
  assert.deepEqual(content.slides.map((slide) => slide.no), [1, 2, 3, 4]);
  assert.equal(new Set(content.slides.map((slide) => slide.teks)).size, content.slides.length);
  assert.ok(content.slides.slice(1).every((slide) => topic.summary.includes(slide.teks)));
  assert.doesNotMatch(JSON.stringify(content.slides), /cta-close|Arah Prospek|ANALISIS DAMPAK|"author"/);
});

test('insufficient source evidence collapses a requested carousel to one useful slide', () => {
  const content = buildDeterministicCarouselSlides({ ...topic, format: 'carousel', summary: '' });
  assert.equal(content.format, 'single');
  assert.equal(content.slides.length, 1);
  assert.equal(content.needs_review, true);
});

test('caption retains the explicit URL, disclaimer and hashtags inside the 2200 character limit', () => {
  const content = buildDeterministicCarouselSlides({ ...topic, summary: topic.summary.repeat(30) }, verification);
  assert.ok(content.caption.length <= 2200, `caption length ${content.caption.length}`);
  assert.ok(content.caption.includes(topic.url));
  assert.match(content.caption, /bukan.*rekomendasi investasi/i);
  for (const tag of content.hashtags) assert.ok(content.caption.includes(tag));
});

test('deterministic fallback never attaches a provided image outside the image allowlist', () => {
  const content = buildDeterministicCarouselSlides({ ...topic, format: 'single', image_url: 'https://localhost/private.png' });
  assert.equal(content.slides[0].data.image_url, undefined);
});

test('designer rejects plausible but unsupported facts, numbers and quotes', async () => {
  config = { designer: { api_key: 'test-only' } };
  responses.designer = { format: 'single', slides: [{ teks: 'BPS menjamin inflasi turun 99%', data: { title: 'BPS menjamin inflasi turun 99%', quote: 'Harga pasti stabil', author: 'Kepala BPS' } }] };
  const design = await designCarouselContent({ ...topic, format: 'single' });
  assert.doesNotMatch(JSON.stringify(design), /99%|menjamin|Harga pasti stabil|Kepala BPS/);
  assert.equal(design.slides[0].teks, topic.title);
});

test('designer allows choosing a provided allowlisted image and removes injected image_data', async () => {
  config = { designer: { api_key: 'test-only' } };
  const image_url = 'https://img.antaranews.com/inflasi.jpg';
  responses.designer = { format: 'single', slides: [{ teks: topic.title, data: { title: topic.title, image_url, image_data: 'data:image/svg+xml,<script>bad</script>' } }] };
  const design = await designCarouselContent({ ...topic, format: 'single', image_url });
  assert.equal(design.slides[0].data.image_url, image_url);
  assert.equal(design.slides[0].data.image_data, undefined);
});

test('invalid designer output over nine slides falls back to validated source content', async () => {
  config = { designer: { api_key: 'test-only' } };
  responses.designer = { format: 'carousel', slides: Array.from({ length: 12 }, () => ({ teks: topic.title })) };
  const design = await designCarouselContent({ ...topic, format: 'carousel' });
  assert.ok(design.slides.length <= 9);
  assert.ok(design.slides.length >= 3);
});

test('copywriter rejects fabricated caption prose and rebuilds mandatory source metadata', async () => {
  config = { copywriter: { api_key: 'test-only' } };
  responses.copywriter = { caption: 'BPS menjamin inflasi turun 99%.', hashtags: ['#PastiUntung'] };
  const content = await buildCarouselSlides({ ...topic, format: 'single' }, verification);
  assert.doesNotMatch(content.caption, /99%|menjamin|PastiUntung/);
  assert.ok(content.caption.includes(topic.url));
  assert.match(content.caption, /bukan.*rekomendasi investasi/i);
});

test('current editorial brief reaches both generators without replacing source evidence', async () => {
  config = { designer: { api_key: 'test-only' }, copywriter: { api_key: 'test-only' } };
  responses.designer = new Error('offline');
  responses.copywriter = new Error('offline');
  const editorialBrief = { prompt: 'Utamakan harga pangan', plan: { format: 'carousel', angle: 'Harga pangan', sections: ['Harga pangan', 'Inflasi tahunan'], caption_tone: 'ringkas' } };
  const content = await buildCarouselSlides(topic, verification, { editorialBrief });
  assert.equal(content.slides[1].teks, 'Harga pangan naik 1,2% pada periode yang sama.');
  assert.ok(content.caption.indexOf('Harga pangan naik') < content.caption.indexOf('Inflasi tahunan Oktober'));
  assert.ok(calls.some((call) => call.agent === 'designer' && call.prompt.includes('Utamakan harga pangan')));
  assert.ok(calls.some((call) => call.agent === 'copywriter' && call.prompt.includes('Harga pangan')));
  assert.equal(content.format, 'carousel');
  assert.equal(topic.title, 'BPS merilis data inflasi Oktober');
});

test('approved caption body keeps configured and explicit verification disclaimers intact', async () => {
  const explicitDisclaimer = 'Data yang disajikan masih bersifat sementara menurut catatan verifikasi.';
  const disclaimer = 'Keterangan publik, bukan rekomendasi investasi beli/jual saham.';
  config = { copywriter: { disclaimer_financial: disclaimer } };
  responses.copywriter = { caption: topic.summary, hashtags: ['#BPS'] };
  const content = await buildCarouselSlides({ ...topic, format: 'single' }, { ...verification, disclaimer: explicitDisclaimer });
  assert.ok(content.caption.includes(explicitDisclaimer));
  assert.ok(content.caption.includes(disclaimer));
  assert.ok(content.caption.includes(topic.url));
  assert.ok(content.caption.length <= 2200);
});

test('designer cannot turn a substring of a source number into a new metric', async () => {
  responses.designer = { format: 'single', slides: [{ teks: topic.title, data: { title: topic.title, value: '1%' } }] };
  const content = await designCarouselContent({ ...topic, format: 'single' });
  assert.equal(content.slides[0].data.value, undefined);
});

test('unsupported plan claims remain editorial directions rather than new story facts', async () => {
  const editorialBrief = { prompt: 'BPS menjamin inflasi turun 99%', plan: { format: 'carousel', sections: ['Harga pangan', 'BPS menjamin inflasi turun 99%'] } };
  responses.designer = new Error('offline');
  responses.copywriter = new Error('offline');
  const content = await buildCarouselSlides(topic, verification, { editorialBrief });
  assert.doesNotMatch(JSON.stringify(content), /99%|menjamin/);
});

test('invalid single output with multiple slides uses fallback rather than silently clipping a story', async () => {
  responses.designer = { format: 'single', slides: [
    { teks: 'Inflasi tahunan Oktober tercatat 2,1%.', data: {} },
    { teks: 'Harga pangan naik 1,2% pada periode yang sama.', data: {} },
  ] };
  const content = await designCarouselContent({ ...topic, format: 'single' });
  assert.equal(content.slides[0].teks, topic.title);
  assert.equal(content.slides.length, 1);
});

test('a quote cannot be reassigned to another institution merely mentioned elsewhere in the source', async () => {
  const source = { ...topic, summary: '“Harga stabil,” kata Kepala BPS. OJK merilis keterangan terpisah.' };
  responses.designer = { format: 'carousel', slides: [
    { teks: topic.title, data: { title: topic.title } },
    { teks: '“Harga stabil,” kata Kepala BPS.', data: { quote: 'Harga stabil,', author: 'OJK' } },
    { teks: 'OJK merilis keterangan terpisah.', data: {} },
  ] };
  const content = await designCarouselContent({ ...source, format: 'carousel' });
  assert.equal(content.slides[1].data.quote, undefined);
});

test('long evidence is selected into readable slides instead of being piled into a final wall of text', () => {
  const summary = Array.from({ length: 24 }, (_, index) => `BPS mencatat komponen nomor ${index + 1} dalam laporan inflasi nasional dengan penjelasan lengkap sesuai data wilayah yang tercatat pada periode laporan.`).join(' ');
  const content = buildDeterministicCarouselSlides({ ...topic, format: 'carousel', summary });
  assert.ok(content.slides.length <= 9);
  assert.ok(content.slides.every((slide) => slide.teks.length <= 300));
  assert.ok(content.slides.slice(1).every((slide) => summary.includes(slide.teks)));
});

test('headline and caption cannot cherry-pick a phrase that drops the source negation', async () => {
  const source = { ...topic, title: 'Klarifikasi BPS', summary: 'Tidak benar bahwa inflasi Oktober naik 9%. BPS meminta pembaca memeriksa dokumen sumber.' };
  responses.designer = { format: 'single', slides: [{ teks: 'inflasi Oktober naik 9%', data: { title: 'inflasi Oktober naik 9%' } }] };
  responses.copywriter = { caption: 'inflasi Oktober naik 9%', hashtags: ['#BPS'] };
  const content = await buildCarouselSlides({ ...source, format: 'single' }, verification);
  assert.equal(content.slides[0].teks, source.title);
  assert.match(content.caption, /Tidak benar bahwa inflasi Oktober naik 9%/);
});

test('designer cannot swap labels and metrics that occur in different source passages', async () => {
  responses.designer = { format: 'carousel', slides: [
    { teks: topic.title, data: {} },
    { layout: 'stat-grid', teks: 'Inflasi tahunan Oktober tercatat 2,1%.', data: { items: [{ label: 'Inflasi tahunan Oktober', value: '1,2%' }] } },
    { layout: 'big-statement', teks: 'Harga pangan naik 1,2% pada periode yang sama.', data: {} },
  ] };
  const content = await designCarouselContent({ ...topic, format: 'carousel' });
  assert.equal(content.slides[1].layout, 'big-statement');
  assert.equal(content.slides[1].data.items, undefined);
});

test('data-dependent layouts cannot omit required data and activate fabricated renderer defaults', async () => {
  for (const layout of ['stat-grid', 'chart-bar', 'chart-line', 'timeline', 'comparison']) {
    responses.designer = { format: 'carousel', slides: [
      { teks: topic.title, data: {} },
      { layout, teks: 'Inflasi tahunan Oktober tercatat 2,1%.', data: {} },
      { layout: 'big-statement', teks: 'Harga pangan naik 1,2% pada periode yang sama.', data: {} },
    ] };
    const content = await designCarouselContent({ ...topic, format: 'carousel' });
    assert.equal(content.slides[1].layout, 'big-statement', layout);
  }
});

test('designer can retain a supported timeline using the renderer events contract', async () => {
  const source = { ...topic, summary: 'Pada 1 Oktober BPS menerbitkan laporan. Pada 2 Oktober BPS memberikan klarifikasi.' };
  responses.designer = { format: 'carousel', slides: [
    { teks: source.title, data: {} },
    { layout: 'timeline', teks: 'Pada 1 Oktober BPS menerbitkan laporan.', data: { events: [{ date: '1 Oktober', text: 'Pada 1 Oktober BPS menerbitkan laporan.' }] } },
    { layout: 'big-statement', teks: 'Pada 2 Oktober BPS memberikan klarifikasi.', data: {} },
  ] };
  const content = await designCarouselContent({ ...source, format: 'carousel' });
  assert.equal(content.slides[1].data.events[0].date, '1 Oktober');
});

test('unknown keys inside structured data cannot smuggle image payloads into rendering', async () => {
  const source = { ...topic, summary: 'BPS melaporkan inflasi 2,1%. Harga pangan naik 1,2%.' };
  responses.designer = { format: 'carousel', slides: [
    { teks: source.title, data: {} },
    { layout: 'stat-grid', teks: 'BPS melaporkan inflasi 2,1%.', data: { items: [{ label: 'inflasi', value: '2,1%', image_data: 'BPS' }] } },
    { layout: 'big-statement', teks: 'Harga pangan naik 1,2%.', data: {} },
  ] };
  const content = await designCarouselContent({ ...source, format: 'carousel' });
  assert.equal(content.slides[1].data.items[0].image_data, undefined);
});

test('an otherwise grounded slide cannot hide a misleading cherry-picked headline in data.title', async () => {
  const source = { ...topic, title: 'Klarifikasi BPS', summary: 'Tidak benar bahwa inflasi Oktober naik 9%.' };
  responses.designer = { format: 'single', slides: [{ teks: source.title, data: { title: 'inflasi Oktober naik 9%' } }] };
  const content = await designCarouselContent({ ...source, format: 'single' });
  assert.equal(content.slides[0].data.title, source.title);
});

test('R3 selected illustration survives normal designer output and deterministic fallback without LLM choosing its ID', async () => {
  const media = { asset_id: 'aa1cc71e-46d3-4db6-bf20-8c9eb066491c', asset_sha256: 'a'.repeat(64), image_kind: 'ai_generated', disclosure_version: 1 };
  const selected = { ...topic, format: 'carousel', cover_illustration: media, image_url: 'https://img.antaranews.com/obsolete-photo.jpg' };
  responses.designer = new Error('offline');
  responses.copywriter = new Error('offline');
  const fallback = await buildCarouselSlides(selected, verification);
  assert.equal(fallback.slides[0].data.asset_id, media.asset_id);
  assert.equal(fallback.slides[0].data.image_url, undefined);
  responses.designer = { format: 'carousel', slides: [
    { teks: topic.title, data: { title: topic.title, asset_id: 'invented-by-model', image_url: selected.image_url } },
    { teks: 'Inflasi tahunan Oktober tercatat 2,1%.', data: {} },
    { teks: 'Harga pangan naik 1,2% pada periode yang sama.', data: {} },
  ] };
  const normal = await buildCarouselSlides(selected, verification);
  assert.equal(normal.slides[0].data.asset_id, media.asset_id);
  assert.equal(normal.slides[0].data.image_url, undefined);
  assert.equal(normal.slides[0].data.image_kind, 'ai_generated');
  assert.ok(calls.filter((call) => call.agent === 'designer').every((call) => !call.prompt.includes('obsolete-photo.jpg')), 'selected AI cover must remove the old source photo from Designer input');
});
