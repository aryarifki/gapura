import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import { renderPayload } from '../images.js';
import { saveIllustrationRaster } from '../../designer/illustrations.js';

test('asset ID hydration verifies local bytes/checksum and overrides browser disclosure/media URLs', async (t) => {
  const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-r3-hydration-');
  t.after(() => fs.rm(storagePath, { recursive: true, force: true }));
  const id = randomUUID();
  const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f7e81' } }).png().toBuffer();
  const asset = { ...(await saveIllustrationRaster(id, { bytes, mime: 'image/png' }, { storagePath })), id, topic_id: '42', status: 'ready', kind: 'ai_generated' };
  let network = 0;
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Ilustrasi layanan', data: { asset_id: id, asset_sha256: asset.sha256, image_kind: 'photo', image_url: 'https://img.antaranews.com/source.jpg', image_data: 'malicious', image_disclosure: 'Foto kejadian', disclosure_version: 1 } }];
  const result = await renderPayload(slides, { storagePath, resolveAsset: async (value) => { assert.equal(value, id); return asset; }, fetchImpl: async () => { network++; throw new Error('no external images'); } });
  assert.equal(network, 0);
  assert.equal(result[0].data.image_data, `data:image/png;base64,${bytes.toString('base64')}`);
  assert.equal(result[0].data.image_kind, 'ai_generated');
  assert.equal(result[0].data.image_url, undefined);
  assert.equal(result[0].data.image_disclosure, undefined);
  assert.equal(slides[0].data.image_data, 'malicious');
  await assert.rejects(renderPayload(slides, { storagePath }), /illustration_resolver_missing/);
  await assert.rejects(renderPayload(slides, { storagePath, resolveAsset: async () => ({ ...asset, status: 'failed' }) }), /illustration_asset_invalid/);
  await assert.rejects(renderPayload([{ ...slides[0], data: { asset_id: id, asset_sha256: '0'.repeat(64) } }], { storagePath, resolveAsset: async () => asset }), /illustration_revision_mismatch/);
});

test('AI metadata without asset ID cannot fall back to a remote photo or arbitrary bytes', async () => {
  const options = { fetchImpl: async () => { throw new Error('must not fetch'); } };
  await assert.rejects(renderPayload([{ teks: 'title', data: { image_kind: 'ai_generated', image_url: 'https://img.antaranews.com/photo.jpg' } }], options), /illustration_id_invalid/);
});
