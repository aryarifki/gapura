import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';

const engine = new RenderEngine(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system'));
const desks = [
  ['POLITIK', 'Memahami proses pemilihan publik', 'Tahapan pemilihan dibahas bersama tanggung jawab lembaga terkait.'],
  ['SOSIAL', 'Akses warga terhadap layanan publik', 'Pengalaman warga memberi konteks bagi perbaikan layanan publik.'],
  ['HUKUM', 'Memahami tahapan pembahasan aturan', 'Dokumen resmi menjelaskan proses pembahasan dan ruang partisipasi warga.'],
  ['LINGKUNGAN', 'Menjaga ruang hijau perkotaan', 'Kondisi ruang hijau berkaitan dengan kebutuhan warga dan tata kota.'],
  ['EKONOMI', 'Ketersediaan pangan dan kebutuhan rumah tangga', 'Rantai pasok dan akses pasar membantu menjelaskan kondisi pangan.'],
  ['BURSA SAHAM', 'Membaca keterbukaan informasi emiten', 'Pengumuman emiten memberi konteks bagi pembaca berita pasar modal.'],
];
const implicitDisclaimer = /disclaimer|bukan rekomendasi investasi|nasihat hukum|Catatan editorial: disusun ulang/i;

function texts(node) {
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  return node?.props ? texts(node.props.children) : [];
}

function makeSlide(layout, [category, title, body], disclaimer) {
  return {
    no: 3, layout, teks: body, source: 'Catatan redaksi',
    data: { category, title, cta: 'Simpan untuk bacaan lanjutan.', ...(disclaimer === undefined ? {} : { disclaimer }) },
  };
}

for (const desk of desks) {
  for (const layout of ['cta-close', 'editorial-fallback']) {
    test(`${desk[0]} ${layout} closes without an implicit investment or legal disclaimer`, () => {
      const slide = makeSlide(layout, desk);
      const rendered = texts(engine.resolveLayout(slide, 3, 3));
      assert.ok(rendered.includes(slide.teks), 'the supplied editorial text must remain');
      assert.doesNotMatch(rendered.join('\n'), implicitDisclaimer);
      if (layout === 'editorial-fallback') {
        assert.deepEqual(engine.resolveLayout(slide, 3, 3), engine.renderFluidLayout(slide, 3, 3));
      }
    });
  }
}

for (const layout of ['cta-close', 'editorial-fallback']) {
  test(`${layout} preserves only an explicitly supplied disclaimer, including outside the final slide`, () => {
    for (const disclaimer of [
      'Catatan redaksi: identitas narasumber dilindungi.',
      'DISCLAIMER RESMI: Bukan rekomendasi investasi atau nasihat hukum individual.',
    ]) {
      for (const [slideIndex, totalSlides] of [[2, 3], [3, 3]]) {
        const slide = makeSlide(layout, desks[1], disclaimer);
        const rendered = texts(engine.resolveLayout(slide, slideIndex, totalSlides));
        assert.equal(rendered.filter((text) => text === disclaimer).length, 1, 'preserve the supplied text once, without an invented label');
      }
    }
    for (const disclaimer of ['', '   ', null]) {
      assert.doesNotMatch(texts(engine.resolveLayout(makeSlide(layout, desks[1], disclaimer), 3, 3)).join('\n'), implicitDisclaimer);
    }
  });

  test(`${layout} renders all six desks to real PNGs offline and paints an explicit disclaimer`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
    for (const desk of desks) {
      const slide = makeSlide(layout, desk);
      const png = await engine.renderSlideToBuffer(slide, 3, 3);
      const metadata = await sharp(png).metadata();
      assert.equal(metadata.format, 'png');
      assert.equal(metadata.width, 1080);
      assert.equal(metadata.height, 1350);
      const stats = await sharp(png).extract({ left: 72, top: 220, width: 936, height: 900 }).stats();
      assert.ok(stats.channels.some((channel) => channel.stdev > 20), `${desk[0]} must paint editorial content`);
      const explicit = await engine.renderSlideToBuffer(makeSlide(layout, desk, 'Catatan redaksi: identitas narasumber dilindungi.'), 3, 3);
      const plainPixels = await sharp(png).removeAlpha().raw().toBuffer();
      const explicitPixels = await sharp(explicit).removeAlpha().raw().toBuffer();
      assert.notDeepEqual(plainPixels, explicitPixels, `${desk[0]} explicit disclaimer must affect rendered pixels`);
    }
  });
}
