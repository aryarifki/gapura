import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { RenderEngine } from '../engine.js';
import { validateSlide } from '../validation.js';
import { validateMediaAsset } from '../../common/editorial-contract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'services/common/test/fixtures/editorial-stories.json'), 'utf8'));

test('R1 synthetic covers reference a real decodable raster with the recorded checksum and dimensions', async () => {
  for (const story of corpus.stories) {
    const asset = story.draft.media.assets[0];
    assert.deepEqual(validateMediaAsset(asset), { valid: true, reason: null });
    const bytes = Buffer.from(fs.readFileSync(path.join(root, asset.local_path), 'utf8').trim(), 'base64');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, asset.width);
    assert.equal(metadata.height, asset.height);
    const pixels = await sharp(bytes).raw().toBuffer();
    assert.equal(pixels.length, asset.width * asset.height * 3);
    assert.doesNotThrow(() => validateSlide({ ...story.draft.slides[0], data: { image_data: `data:image/png;base64,${bytes.toString('base64')}` } }));
  }
});

test('R1 embedded synthetic raster reaches the existing renderer entirely in memory', async () => {
  const bytes = Buffer.from(fs.readFileSync(path.join(root, 'services/common/test/fixtures/editorial-cover.png.base64'), 'utf8').trim(), 'base64');
  const engine = new RenderEngine(path.join(root, 'design-system'));
  const output = await engine.renderSlideToBuffer({
    no: 1, layout: 'cover-focus', teks: 'Fixture R1: gambar lokal',
    data: { title: 'Fixture R1: gambar lokal', image_data: `data:image/png;base64,${bytes.toString('base64')}` },
  }, 1, 6);
  const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1350);
  let fixturePixels = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] === 31 && data[i + 1] === 126 && data[i + 2] === 129) fixturePixels++;
  }
  assert.ok(fixturePixels > 300000, 'the flat raster must cover the image area, not only small brand accents');
});
