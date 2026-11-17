import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';
import { validateSlide } from '../validation.js';

const designPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../design-system');
const engine = new RenderEngine(designPath);
const DISCLOSURE = 'Ilustrasi AI · Gapura Media';
const ASSET_ID = '2d30e364-b95d-4d49-82ed-43c548270944';
const IMAGE_COLOR = [214, 40, 155];
// Synthetic raster only: no provider/model, external image, API or storage service.
const raster = await sharp({ create: { width: 936, height: 390, channels: 3, background: { r: 214, g: 40, b: 155 } } }).png().toBuffer();
const imageData = `data:image/png;base64,${raster.toString('base64')}`;
const makeSlide = (layout = 'cover-focus', no = 1) => ({
  no, layout,
  teks: 'Penjelasan mekanisme kebijakan dari catatan redaksi.',
  source: 'Catatan redaksi',
  data: {
    title: 'Bagaimana kebijakan bekerja',
    asset_id: ASSET_ID,
    image_kind: 'ai_generated',
    image_data: imageData,
    image_disclosure: 'Foto dokumentasi tanpa AI',
    image_credit: 'Kredit dari klien',
    credit: 'Fotografer dari klien',
  },
});

function walk(node) {
  if (!node || typeof node !== 'object') return [];
  const children = node.props?.children;
  return [node, ...(Array.isArray(children) ? children : [children]).flatMap(walk)];
}

function texts(tree) {
  return walk(tree).flatMap((node) => {
    const children = node.props?.children;
    return (Array.isArray(children) ? children : [children]).filter((child) => typeof child === 'string');
  });
}

function assertIllustrationTree(tree) {
  const images = walk(tree).filter((node) => node.type === 'img');
  assert.equal(images.length, 1, 'the hydrated raster must reach the slide tree');
  assert.equal(images[0].props.src, imageData);
  assert.equal(texts(tree).filter((text) => text === DISCLOSURE).length, 1, 'every AI raster needs exactly one constant disclosure');
  for (const clientText of ['Foto dokumentasi tanpa AI', 'Kredit dari klien', 'Fotografer dari klien']) {
    assert.equal(texts(tree).includes(clientText), false, 'client disclosure/credit cannot replace the renderer label');
  }
}

async function assertIllustrationPixels(input, name) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1350);
  let imagePixels = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (IMAGE_COLOR.every((channel, index) => Math.abs(data[offset + index] - channel) <= 12)) {
        imagePixels++;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  assert.ok(imagePixels > 300000, `${name}: embedded raster must fill a real image area (${imagePixels} matching pixels)`);
  let labelPixels = 0;
  // The flat fixture has no light pixels. Light ink within its bounds proves the
  // tree's disclosure is painted onto the image and survives raster conversion.
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] > 210 && data[offset + 1] > 210 && data[offset + 2] > 210) labelPixels++;
    }
  }
  assert.ok(labelPixels > 500, `${name}: disclosure ink must remain visible within the image (${labelPixels} light pixels)`);
}

test('AI cover embeds the local raster and constant label even when source display is disabled', () => {
  const withoutSource = Object.create(engine);
  withoutSource.wrapSlide = (content, options) => engine.wrapSlide(content, { ...options, showSource: false });
  const tree = withoutSource.resolveLayout(makeSlide(), 1, 3);
  assertIllustrationTree(tree);
  assert.equal(texts(tree).includes('Catatan redaksi'), false);
});

test('illustration body keeps the provided headline, prose and image without inventing figures', () => {
  const tree = engine.resolveLayout(makeSlide('illustration', 2), 2, 3);
  assertIllustrationTree(tree);
  assert.deepEqual(texts(tree).sort(), [
    'GAPURA', 'MEDIA', '02 / 03', DISCLOSURE,
    'Bagaimana kebijakan bekerja', 'Penjelasan mekanisme kebijakan dari catatan redaksi.',
    'Catatan redaksi', '@gapuramedia',
  ].sort());
});

test('unknown layouts and the direct fluid fallback retain the same AI image and disclosure', () => {
  const slide = makeSlide('editorial-fallback', 2);
  assertIllustrationTree(engine.resolveLayout(slide, 2, 3));
  assertIllustrationTree(engine.renderFluidLayout(slide, 2, 3));
});

test('AI assets keep their label when attached to an existing body layout', () => {
  for (const layout of ['big-statement', 'stat-grid', 'chart-bar', 'chart-line', 'regulasi', 'timeline', 'comparison', 'cta-close', 'verifikasi']) {
    assertIllustrationTree(engine.resolveLayout(makeSlide(layout, 2), 2, 3));
  }
});

test('legacy embedded source photos remain valid and do not acquire an AI label', () => {
  const slide = makeSlide();
  delete slide.data.image_kind;
  slide.data.asset_id = 'legacy-asset-1';
  assert.doesNotThrow(() => validateSlide(slide));
  const tree = engine.resolveLayout(slide, 1, 3);
  assert.equal(walk(tree).filter((node) => node.type === 'img').length, 1);
  assert.equal(texts(tree).includes(DISCLOSURE), false);
});

test('hydrated AI metadata accepts UUIDs and existing supported embedded raster types', async () => {
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = await sharp(raster).toFormat(format).toBuffer();
    const slide = makeSlide();
    slide.data.asset_id = ASSET_ID.toUpperCase();
    slide.data.image_data = `data:image/${format};base64,${bytes.toString('base64')}`;
    assert.doesNotThrow(() => validateSlide(slide), format);
  }
});

for (const image_kind of ['photo', 'unknown', 'AI_GENERATED', '', null, false, {}]) {
  test(`rejects unsupported image_kind ${JSON.stringify(image_kind)}`, () => {
    const slide = makeSlide();
    slide.data.image_kind = image_kind;
    assert.throws(() => validateSlide(slide), { status: 400, message: /image_kind/ });
  });
}

for (const asset_id of [undefined, null, '', 'asset-1', '../asset', `${ASSET_ID}/extra`, `${ASSET_ID}\n`, `urn:uuid:${ASSET_ID}`, '00000000-0000-0000-0000-000000000000', 1, {}]) {
  test(`rejects AI image with unsafe or missing asset_id ${JSON.stringify(asset_id)}`, () => {
    const slide = makeSlide();
    if (asset_id === undefined) delete slide.data.asset_id;
    else slide.data.asset_id = asset_id;
    assert.throws(() => validateSlide(slide), { status: 400, message: /asset_id/ });
  });
}

for (const image_data of [
  undefined, null, '', 'https://example.invalid/illustration.png', 'file:///etc/passwd',
  'data:image/png;base64,not-base64!',
  `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
  `data:image/jpeg;base64,${raster.toString('base64')}`,
]) {
  test(`rejects AI claim without a valid embedded raster ${String(image_data).slice(0, 60)}`, () => {
    const slide = makeSlide();
    if (image_data === undefined) delete slide.data.image_data;
    else slide.data.image_data = image_data;
    assert.throws(() => validateSlide(slide), { status: 400, message: /image_data/ });
  });
}

for (const [layout, no] of [['cover-focus', 1], ['illustration', 2], ['editorial-fallback', 2], ['big-statement', 2]]) {
  test(`${layout} preview paints the AI raster and disclosure without network access`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
    const slide = makeSlide(layout, no);
    await assertIllustrationPixels(await engine.renderSlideToBuffer(slide, no, 3), layout);
  });
}

test('AI rendering rejects a truncated raster rather than exporting a blank image', async () => {
  for (const [format, hex] of [['png', '89504e470d0a1a0a'], ['jpeg', 'ffd8ff'], ['webp', '524946460000000057454250']]) {
    const slide = makeSlide();
    slide.data.image_data = `data:image/${format};base64,${Buffer.from(hex, 'hex').toString('base64')}`;
    await assert.rejects(engine.renderSlideToBuffer(slide, 1, 1), { status: 400, message: /image_data/ });
  }
});

test('disk export produces real PNG and JPEG files retaining the image and visible disclosure', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('External requests disabled'); });
  const output = fs.mkdtempSync('/tmp/opencode/gapura-r3-render-');
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const slides = [makeSlide(), makeSlide('illustration', 2), makeSlide('editorial-fallback', 3)];
  const results = await engine.renderCarouselToDisk(41, slides, output);
  assert.equal(results.length, slides.length);
  for (const [index, slide] of slides.entries()) {
    for (const [extension, format] of [['png', 'png'], ['jpg', 'jpeg']]) {
      const filename = path.join(output, '41', `slide_${index + 1}.${extension}`);
      assert.equal(fs.statSync(filename).isFile(), true);
      assert.equal((await sharp(filename).metadata()).format, format);
      await assertIllustrationPixels(filename, `${slide.layout} ${extension}`);
    }
  }
});
