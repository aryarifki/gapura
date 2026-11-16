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
