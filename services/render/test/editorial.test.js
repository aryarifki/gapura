import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';

const engine = new RenderEngine(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system'));

test('headline stays legible on the dark editorial cover', async () => {
  const png = await engine.renderSlideToBuffer({ layout: 'cover-focus', teks: 'Inflasi Oktober Melandai ke 2,1%', data: { title: 'Inflasi Oktober Melandai ke 2,1%' } }, 1, 1);
  const { data, info } = await sharp(png).extract({ left: 72, top: 300, width: 936, height: 950 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let lightPixels = 0;
  for (let pixel = 0; pixel < data.length; pixel += info.channels) if (data[pixel] > 160 && data[pixel + 1] > 160 && data[pixel + 2] > 160) lightPixels++;
  assert.ok(lightPixels > 15000, `headline contrast too low: only ${lightPixels} light pixels in the content area`);
});

test('source photo and a long headline render within a portrait canvas', async () => {
  const photo = await sharp({ create: { width: 936, height: 390, channels: 3, background: '#778899' } }).png().toBuffer();
  const png = await engine.renderSlideToBuffer({ layout: 'cover-focus', teks: 'Kebijakan Bank Indonesia Menjaga Stabilitas Rupiah di Tengah Perubahan Suku Bunga Global dan Penguatan Dolar Amerika', data: { image_data: `data:image/png;base64,${photo.toString('base64')}`, value: '2,1%', unit: 'YoY' } }, 1, 1);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  const cropped = await sharp(png).extract({ left: 0, top: 1320, width: 1080, height: 30 }).toBuffer();
  const bottom = await sharp(cropped).stats();
  assert.ok(bottom.channels.every((channel) => channel.stdev < 2), 'content must not bleed into the bottom safe margin');
});

test('concurrent live previews cannot leak design overrides into the next render', async () => {
  const original = structuredClone(engine.tokens);
  const slide = { layout: 'cover-focus', teks: 'Data sumber' };
  await Promise.all([
    engine.renderSlideToBuffer(slide, 1, 1, { palette: { cover_bg: '#112233' } }),
    engine.renderSlideToBuffer(slide, 1, 1, { palette: { cover_bg: '#334455' } }),
  ]);
  assert.deepEqual(engine.tokens, original);
});

test('ordinary source prose is not presented as an official quotation and remains readable', async () => {
  const slide = { layout: 'big-statement', teks: 'Inflasi Oktober tercatat 2,1% menurut data BPS.', data: { title: 'Konteks data' }, source: 'BPS' };
  const view = JSON.stringify(engine.resolveLayout(slide, 2, 3));
  assert.equal(view.includes('PERNYATAAN RESMI'), false);
  assert.equal(view.includes('“Inflasi'), false);
  const png = await engine.renderSlideToBuffer(slide, 2, 3);
  const crop = await sharp(png).extract({ left: 110, top: 220, width: 850, height: 500 }).toBuffer();
  const { data, info } = await sharp(crop).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let dark = 0;
  for (let index = 0; index < data.length; index += info.channels) if (data[index] < 90 && data[index + 1] < 100 && data[index + 2] < 120) dark++;
  assert.ok(dark > 1000, 'body text must have dark ink on the light body panel');
});

test('ordinary news paragraphs never become attributed official quotations', () => {
  const vdom = engine.resolveLayout({ layout: 'big-statement', teks: 'Inflasi mencapai 2,1% menurut rilis sumber.', data: {} }, 2, 3);
  assert.equal(JSON.stringify(vdom).includes('PERNYATAAN RESMI'), false);
  assert.equal(JSON.stringify(vdom).includes('“Inflasi'), false);
});

test('editorial-lead renders only the article, in one uniform size, inside the frame', async () => {
  const paragraphs = [
    'Indeks ditutup menguat 69,52 poin atau 1,35 persen ke level 5.215,85 pada perdagangan Senin, 23 November 2026. Penguatan ini berbalik dari penurunan mingguan 3,71 persen yang tercatat pada pekan sebelumnya.',
    'Indeks dibuka di level 5.134,06, lalu sempat turun menyentuh level terendah 5.062,09 sebelum berbalik naik hingga 5.244,35 dan ditutup menguat di 5.215,85.',
    'Total nilai transaksi di bursa mencapai Rp 10,96 triliun, dengan 398 saham menguat, 278 saham melemah, dan 269 saham stagnan sepanjang sesi perdagangan.',
    'Penguatan berlangsung di tengah kabar pembicaraan mengenai klasifikasi pasar saham Indonesia. Sektor bahan baku melonjak 4,42 persen dan memimpin penguatan sektor pada penutupan perdagangan.',
  ].map((text) => ({ text, fact_ids: [] }));
  const slide = {
    layout: 'editorial-lead', role: 'lead', source: 'FXStreet Indonesia · Investor.id · StockWatch',
    teks: 'IHSG ditutup menguat 69,52 poin ke level 5.215,85 pada Senin, 23 November 2026.',
    data: { title: 'Artikel Lengkap', paragraphs },
  };
  const view = JSON.stringify(engine.resolveLayout(slide, 2, 3));
  assert.equal(view.includes('Artikel Lengkap'), false, 'lead slide must not draw the data.title heading');
  const articleBlocks = new Set([slide.teks, ...paragraphs.map((paragraph) => paragraph.text)]);
  const sizes = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const kids = node.props?.children;
    if (typeof kids === 'string' && node.props?.style?.fontSize && articleBlocks.has(kids)) sizes.add(node.props.style.fontSize);
    if (Array.isArray(kids)) kids.forEach(walk);
    else if (kids && typeof kids === 'object') walk(kids);
  };
  walk(engine.resolveLayout(slide, 2, 3));
  assert.equal(sizes.size, 1, `article blocks must share one font size, got ${[...sizes].join(', ')}`);
  const png = await engine.renderSlideToBuffer(slide, 2, 3);
  const bottom = await sharp(await sharp(png).extract({ left: 0, top: 1320, width: 1080, height: 30 }).toBuffer()).stats();
  assert.ok(bottom.channels.every((channel) => channel.stdev < 2), 'article text must not bleed into the bottom safe margin');
});

test('editorial-close question fits inside the right safe margin', async () => {
  const slide = {
    layout: 'editorial-close', role: 'close', source: 'FXStreet Indonesia · Investor.id · StockWatch',
    teks: 'Ikuti Gapura Media untuk kabar terverifikasi setiap hari. Bagikan berita ini agar makin banyak yang terbantu, dan dukung kami terus berkarya.',
    data: { title: 'Tetap Terhubung', question: 'Sudah follow @gapuramedia?' },
  };
  const png = await engine.renderSlideToBuffer(slide, 3, 3);
  const strip = await sharp(png).extract({ left: 1010, top: 150, width: 70, height: 500 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let mint = 0;
  for (let pixel = 0; pixel < strip.data.length; pixel += strip.info.channels) {
    if (strip.data[pixel] < 170 && strip.data[pixel + 1] > 150 && strip.data[pixel + 2] > 140) mint++;
  }
  assert.equal(mint, 0, 'question text must not overflow past the right content margin');
});
