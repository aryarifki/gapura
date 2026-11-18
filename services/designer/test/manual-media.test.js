import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import {
  MAX_INPUT_BYTES, parseManualUpload, readManualMedia, saveManualMediaRaster,
} from '../manual-media.js';

const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-manual-media-');
test.after(() => fs.rm(storagePath, { recursive: true, force: true }));

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('parseManualUpload accepts one bounded raster data URI and rejects other inputs', () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const parsed = parseManualUpload(`data:image/jpeg;base64,${bytes.toString('base64')}`);
  assert.equal(parsed.mime, 'image/jpeg');
  assert.deepEqual(parsed.bytes, bytes);
  assert.throws(() => parseManualUpload('not-a-data-uri'), /media_type_invalid/);
  assert.throws(() => parseManualUpload(`data:image/svg+xml;base64,${bytes.toString('base64')}`), /media_type_invalid/);
  assert.throws(() => parseManualUpload(`data:image/png;base64,${bytes.toString('base64').slice(0, -2)}`), /media_type_invalid/);
  assert.throws(() => parseManualUpload(`data:image/png;base64,${'A'.repeat(Math.ceil(MAX_INPUT_BYTES / 3) * 4 + 8)}`), /media_too_large/);
});

test('processing bounds dimensions, removes alpha and stores an immutable checksummed raster', async () => {
  const source = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer();
  const id = randomUUID();
  const saved = await saveManualMediaRaster(id, source, { storagePath });
  assert.equal(saved.mime, 'image/jpeg');
  assert.equal(saved.width, 1600);
  assert.ok(saved.height > 900 && saved.height < 1200, `height ${saved.height}`);
  assert.ok(saved.byte_size < source.length);
  assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  assert.equal(saved.local_path, `media/manual/${id}.jpg`);
  const metadata = await sharp(await fs.readFile(`${storagePath}/${saved.local_path}`)).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.hasAlpha, false);

  const asset = { id, kind: 'editor_upload', ...saved };
  const bytes = await readManualMedia(asset, { storagePath });
  assert.equal(digest(bytes), saved.sha256);
  await assert.rejects(readManualMedia({ ...asset, sha256: '0'.repeat(64) }, { storagePath }), /media_checksum_mismatch/);
  await assert.rejects(readManualMedia({ ...asset, local_path: 'media/manual/other.jpg' }, { storagePath }), /media_path_invalid/);
});

test('rejects rasters below the editorial minimum instead of storing an unusable cover', async () => {
  const source = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#ffffff' } }).png().toBuffer();
  await assert.rejects(saveManualMediaRaster(randomUUID(), source, { storagePath }), /media_dimensions_invalid/);
});
