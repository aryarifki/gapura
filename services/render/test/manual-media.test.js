import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';
import { validateSlide } from '../validation.js';

const engine = new RenderEngine(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system'));
const assetId = '2d30e364-b95d-4d49-82ed-43c548270944';

function texts(node) {
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  return node?.props ? texts(node.props.children) : [];
}

let imageData;
test.before(async () => {
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f7e81' } }).png().toBuffer();
  imageData = `data:image/png;base64,${png.toString('base64')}`;
});

const manual = () => ({
  asset_id: assetId, asset_sha256: 'a'.repeat(64), image_kind: 'editor_upload',
  credit: 'Dokumentasi Gapura Media', rights_basis: 'own_work', image_data: imageData,
});

test('editor uploads are accepted with credit and a known rights basis', () => {
  const slide = { no: 1, layout: 'cover-focus', teks: 'Cover manual', data: manual() };
  assert.equal(validateSlide(slide), slide);
  assert.doesNotThrow(() => validateSlide({ ...slide, no: 2, data: { ...manual(), rights_basis: 'licensed_stock' } }));
});

test('editor uploads without attribution or with malformed provenance are rejected', () => {
  const base = { no: 1, layout: 'cover-focus', teks: 'Cover manual' };
  for (const [data, message] of [
    [{ ...manual(), credit: '' }, /credit/],
    [{ ...manual(), rights_basis: 'unknown' }, /rights_basis/],
    [{ ...manual(), asset_id: 'not-a-uuid' }, /asset_id/],
    [{ ...manual(), image_data: undefined }, /image_data/],
    [{ ...manual(), asset_sha256: 'bad' }, /asset_sha256/],
  ]) {
    assert.throws(() => validateSlide({ ...base, data }), message);
  }
  assert.throws(() => validateSlide({ ...base, data: { ...manual(), image_kind: 'publisher_photo' } }), /image_kind/);
});

test('cover slide 1 renders the manual raster with credit instead of the AI disclosure', () => {
  const slide = { no: 1, layout: 'cover-focus', teks: 'Cover manual', data: { ...manual(), title: 'Judul cover' } };
  const flat = texts(engine.resolveLayout(slide, 1, 1)).join(' ');
  assert.match(flat, /Gambar: Dokumentasi Gapura Media/);
  assert.doesNotMatch(flat, /Ilustrasi AI/);
});

test('a body slide may carry an optional manual image', async () => {
  const slide = { no: 2, layout: 'illustration', teks: 'Penjelasan visual', data: { ...manual(), title: 'Penjelasan visual' } };
  const png = await engine.renderSlideToBuffer(slide, 2, 2);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1350);
  const flat = texts(engine.resolveLayout(slide, 2, 2)).join(' ');
  assert.match(flat, /Gambar: Dokumentasi Gapura Media/);
});
