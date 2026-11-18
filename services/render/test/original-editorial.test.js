import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';
import { validateSlide, validatePreview } from '../validation.js';
import { layoutData } from './helpers/layout-data.js';

const engine = new RenderEngine(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system'));
const script = 'Akses layanan dapat berbeda menurut kebutuhan warga; pembaca perlu melihat syarat dan jalur pertanyaan yang tersedia.';
const forbiddenFillers = /SIMPAN DATA INI|Ikuti @|Arsipkan untuk referensi|Bagikan kepada publik|Tulis pandangan|Simpan postingan ini|SEBELUMNYA|SAAT INI \/ DAMPAK/;

function texts(node) {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return node?.props ? texts(node.props.children) : [];
}

function makeSlide(layout, data = {}) {
  return { no: 2, layout, teks: script, data, source: 'Catatan redaksi uji' };
}

async function assertPng(png) {
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  const stats = await sharp(png).extract({ left: 72, top: 200, width: 936, height: 1000 }).stats();
  assert.ok(stats.channels.some((channel) => channel.stdev > 20), 'editorial content must paint the actual PNG');
}

const invalidData = {
  'stat-grid': [{}, { items: [] }, { items: [{}] }, { items: [{ label: '   ', value: '7' }] }, { items: [{ label: 'Catatan', value: '' }] }, { items: [{ label: 'Catatan' }] }],
  'chart-bar': [{}, { labels: [], values: [] }, { labels: ['Wilayah'] }, { values: [7] }, { labels: [' '], values: [7] }, { labels: ['Wilayah'], values: [] }],
  'chart-line': [{}, { labels: [], values: [] }, { labels: ['Periode'] }, { values: [7] }, { labels: [' '], values: [7] }, { labels: ['Periode'], values: [] }],
  timeline: [{}, { events: [] }, { events: [{}] }, { events: [{ date: ' ', text: 'Dokumen uji.' }] }, { events: [{ date: '2026-01-04', text: '' }] }],
  comparison: [{}, { left: layoutData.comparison.left }, { right: layoutData.comparison.right }, { left: {}, right: {} }, { left: { title: ' ', text: 'Catatan uji' }, right: layoutData.comparison.right }, { left: layoutData.comparison.left, right: { title: 'Pilihan', text: ' ' } }],
};

for (const [layout, missing] of Object.entries(invalidData)) {
  test(`${layout} rejects absent, empty and incomplete data with an actionable 400`, async () => {
    const field = layout === 'stat-grid' ? /items/ : layout.startsWith('chart-') ? /labels|values/ : layout === 'timeline' ? /events/ : /left|right/;
    for (const data of missing) {
      const slide = makeSlide(layout, data);
      for (const validate of [() => validateSlide(slide), () => validatePreview(slide, 2, 3), () => engine.resolveLayout(slide, 2, 3)]) {
        assert.throws(validate, { status: 400, message: field }, `${layout}: ${JSON.stringify(data)}`);
      }
      await assert.rejects(engine.renderSlideToBuffer(slide, 2, 3), { status: 400, message: field });
    }
  });

  test(`${layout} retains actual archival data and script and renders an offline PNG`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
    const slide = makeSlide(layout, structuredClone(layoutData[layout]));
    const original = structuredClone(slide);
    assert.doesNotThrow(() => validateSlide(slide));
    const rendered = texts(engine.resolveLayout(slide, 2, 3));
    assert.ok(rendered.includes(script));
    const supplied = layout === 'stat-grid' ? slide.data.items.flatMap((item) => [item.label, String(item.value)])
      : layout.startsWith('chart-') ? [...slide.data.labels, ...slide.data.values.map(String)]
        : layout === 'timeline' ? slide.data.events.flatMap((event) => [event.date, event.text])
          : [slide.data.left.title, slide.data.left.text, slide.data.right.title, slide.data.right.text];
    for (const value of supplied) assert.ok(rendered.includes(value), `${layout} must preserve ${value}`);
    assert.doesNotMatch(rendered.join('\n'), forbiddenFillers);
    await assertPng(await engine.renderSlideToBuffer(slide, 2, 3));
    assert.deepEqual(slide, original, 'rendering must not mutate supplied editorial input');
  });
}

test('a batch with missing data is rejected before files or a staging directory are written', async (t) => {
  const output = fs.mkdtempSync('/tmp/opencode/render-original-');
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  for (const layout of Object.keys(layoutData)) {
    await assert.rejects(engine.renderCarouselToDisk(41, [{ no: 1, layout: 'cover-focus', teks: 'Membaca akses layanan' }, makeSlide(layout)], output), { status: 400 });
    assert.deepEqual(fs.readdirSync(output), []);
  }
});

for (const layout of ['editorial-fallback', 'cta-close']) {
  test(`${layout} never appends a mandatory close and preserves explicit CTA and disclaimer on any body slide`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
    for (const [slideIndex, totalSlides] of [[2, 3], [3, 3]]) {
      const slide = makeSlide(layout, { title: 'Memahami akses layanan' });
      const plain = texts(engine.resolveLayout(slide, slideIndex, totalSlides));
      assert.ok(plain.includes(script));
      assert.doesNotMatch(plain.join('\n'), forbiddenFillers);
      const png = await engine.renderSlideToBuffer(slide, slideIndex, totalSlides);
      await assertPng(png);
      slide.data.cta = 'Baca petunjuk layanan yang tersedia.';
      slide.data.disclaimer = 'Catatan redaksi: identitas narasumber dilindungi.';
      const explicit = texts(engine.resolveLayout(slide, slideIndex, totalSlides));
      assert.equal(explicit.filter((text) => text === slide.data.cta).length, 1);
      assert.equal(explicit.filter((text) => text === slide.data.disclaimer).length, 1);
      assert.doesNotMatch(explicit.join('\n'), forbiddenFillers);
      const explicitPng = await engine.renderSlideToBuffer(slide, slideIndex, totalSlides);
      await assertPng(explicitPng);
      assert.notDeepEqual(await sharp(png).raw().toBuffer(), await sharp(explicitPng).raw().toBuffer());
    }
  });
}

test('the final fluid slide has the same supplied content as an ordinary body slide', () => {
  const slide = makeSlide('editorial-fallback');
  const body = texts(engine.resolveLayout(slide, 2, 3)).filter((text) => text !== '02 / 03');
  const last = texts(engine.resolveLayout(slide, 3, 3)).filter((text) => text !== '03 / 03');
  assert.deepEqual(last, body);
});

test('cover layouts retain the supplied script when a separate headline is present', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
  for (const layout of ['cover-focus', 'cover-stat']) {
    const slide = { no: 1, layout, teks: script, data: { title: 'Memahami akses layanan', value: 0, unit: 'catatan uji' } };
    const rendered = texts(engine.resolveLayout(slide, 1, 3));
    assert.ok(rendered.includes(script));
    assert.match(rendered.join(' '), /Memahami akses layanan/);
    assert.ok(rendered.includes('0'), 'zero is supplied data, not an absent stat');
    await assertPng(await engine.renderSlideToBuffer(slide, 1, 3));
  }
});

test('ordinary body prose stays present alongside an explicitly supplied quotation', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
  for (const layout of ['big-statement', 'editorial-fallback']) {
    const slide = makeSlide(layout, { title: 'Konteks layanan', quote: 'Petunjuk dapat dibaca di loket.', author: 'Narasumber uji' });
    const rendered = texts(engine.resolveLayout(slide, 2, 3));
    assert.ok(rendered.includes(script), 'the quotation must not replace the editorial script');
    assert.ok(rendered.includes('“Petunjuk dapat dibaca di loket.”'));
    await assertPng(await engine.renderSlideToBuffer(slide, 2, 3));
  }
});

test('an author field alone cannot turn ordinary fluid prose into an attributed quotation', () => {
  const slide = makeSlide('editorial-fallback', { author: 'Narasumber uji' });
  const rendered = texts(engine.resolveLayout(slide, 2, 3));
  assert.equal(rendered.filter((text) => text === script).length, 1);
  assert.equal(rendered.includes(`“${script}”`), false);
  assert.equal(rendered.includes('— Narasumber uji'), false);
});

test('fluid comparisons do not invent time labels and supplied zero metrics remain visible', () => {
  const slide = makeSlide('editorial-fallback', {
    left: { text: 'Petunjuk layanan langsung.' }, right: { text: 'Petunjuk layanan daring.' },
    value: 0, items: [{ label: 'Catatan kosong', value: 0 }],
  });
  const rendered = texts(engine.resolveLayout(slide, 2, 3));
  assert.doesNotMatch(rendered.join('\n'), /SEBELUMNYA|SAAT INI \/ DAMPAK/);
  assert.equal(rendered.filter((value) => value === '0').length, 2);
  assert.ok(rendered.includes(script));
});

test('a missing source does not add an unsolicited brand tagline to the narrative', () => {
  const slide = makeSlide('editorial-fallback');
  delete slide.source;
  assert.equal(texts(engine.resolveLayout(slide, 3, 3)).includes(engine.tokens.brand.tagline), false);
});
