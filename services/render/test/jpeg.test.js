import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { ensureJpegDerivatives } from '../engine.js';

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gapura-jpeg-'));

test('derives a JPEG sibling for every PNG slide and leaves existing derivatives untouched', async () => {
  const root = tempRoot();
  const draft = path.join(root, '7');
  fs.mkdirSync(draft, { recursive: true });
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#101010' } }).png().toBuffer();
  fs.writeFileSync(path.join(draft, 'slide_1.png'), png);
  fs.writeFileSync(path.join(draft, 'slide_2.png'), png);
  fs.writeFileSync(path.join(draft, 'slide_2.jpg'), 'already-there');

  const created = await ensureJpegDerivatives(root);

  assert.equal(created, 1);
  assert.equal(fs.existsSync(path.join(draft, 'slide_1.jpg')), true);
  assert.equal(fs.readFileSync(path.join(draft, 'slide_2.jpg'), 'utf8'), 'already-there');
  const metadata = await sharp(path.join(draft, 'slide_1.jpg')).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.chromaSubsampling, '4:4:4');
  fs.rmSync(root, { recursive: true, force: true });
});

test('ignores missing storage roots and staging directories', async () => {
  assert.equal(await ensureJpegDerivatives(path.join(os.tmpdir(), 'gapura-jpeg-does-not-exist')), 0);
  const root = tempRoot();
  fs.mkdirSync(path.join(root, '.7.render-abc'), { recursive: true });
  fs.writeFileSync(path.join(root, '.7.render-abc', 'slide_1.png'), 'not-a-png');
  assert.equal(await ensureJpegDerivatives(root), 0);
  fs.rmSync(root, { recursive: true, force: true });
});
