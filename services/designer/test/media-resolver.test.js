import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import { resolveEditorialMedia } from '../media-resolver.js';

const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-media-resolver-');
test.after(() => fs.rm(storagePath, { recursive: true, force: true }));
const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#cccccc' } }).jpeg().toBuffer();
await fs.writeFile(path.join(storagePath, 'photo.jpg'), bytes);
const asset = { id: 'bank-indonesia-archive', local_path: 'photo.jpg', credit: 'Fotografer teruji', license: 'CC BY-SA 4.0',
  sha256: createHash('sha256').update(bytes).digest('hex'), tags: ['bank indonesia', 'bi rate'], photo_role: 'institution_archive' };
const resolve = (options = {}) => resolveEditorialMedia({ topic: 'Keputusan Bank Indonesia menaikkan BI-Rate', assets: [asset], storagePath, ...options });

test('matching uses curated entity/topic tags and verifies local raster provenance', async () => {
  const result = await resolve();
  assert.equal(result.mode, 'photo');
  assert.equal(result.asset.sha256, asset.sha256);
  assert.equal(result.asset.width, 640);
  assert.ok(result.evidence.matched_tags.includes('bank indonesia'));
  assert.equal(result.evidence.photo_role, 'institution_archive');
});

test('an unrelated cityscape is never passed off as BEI and typography needs no asset', async () => {
  const result = await resolve({ topic: 'BEI dan MSCI meninjau transparansi emiten', assets: [{ ...asset, title: 'BEI', tags: ['mega kuningan', 'jakarta', 'ekonomi'] }] });
  assert.equal(result.mode, 'typography');
  assert.equal(result.asset, null);
  assert.equal(result.evidence.photo_required, false);
  assert.equal((await resolve({ topic: 'Ekonomi nasional', assets: [{ ...asset, tags: ['ekonomi'] }] })).mode, 'typography');
});

test('missing licenses, credits, tags, hashes, wrong bytes and generated photos fall back conservatively', async () => {
  for (const change of [{ credit: '' }, { license: '' }, { tags: [] }, { sha256: '0'.repeat(64) }, { generated: true }, { license: 'licensed_stock' }, { license: 'all rights reserved' }]) {
    assert.equal((await resolve({ assets: [{ ...asset, ...change }] })).mode, 'typography');
  }
});

test('traversal, symlinks and nonrasters with truthful hashes cannot become photos', async () => {
  await fs.symlink(path.join(storagePath, 'photo.jpg'), path.join(storagePath, 'linked.jpg'));
  for (const local_path of ['../photo.jpg', 'linked.jpg', '/etc/passwd']) {
    assert.equal((await resolve({ assets: [{ ...asset, local_path }] })).mode, 'typography');
  }
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"></svg>');
  await fs.writeFile(path.join(storagePath, 'fake.jpg'), svg);
  assert.equal((await resolve({ assets: [{ ...asset, local_path: 'fake.jpg', sha256: createHash('sha256').update(svg).digest('hex') }] })).mode, 'typography');
});

test('repeated assets can be excluded by ID or hash; equal matches retain manifest order', async () => {
  assert.equal((await resolve({ usedAssetIds: [asset.id] })).mode, 'typography');
  assert.equal((await resolve({ usedAssetHashes: [asset.sha256] })).mode, 'typography');
  assert.equal((await resolve({ assets: [asset, { ...asset, id: 'second' }] })).asset.id, asset.id);
});

test('photo adapters run only after local misses and explicit verified-license configuration', async () => {
  let calls = 0;
  const search = async ({ limit }) => { calls++; assert.equal(limit, 5); return [asset]; };
  for (const config of [{ search }, { enabled: true, search }, { enabled: false, licenseVerified: true, search }]) {
    assert.equal((await resolve({ assets: [], licensedPhotoApi: config })).mode, 'typography');
  }
  assert.equal(calls, 0);
  const adapter = { enabled: true, licenseVerified: true, search };
  assert.equal((await resolve({ licensedPhotoApi: adapter })).evidence.origin, 'local_bank');
  assert.equal(calls, 0);
  assert.equal((await resolve({ assets: [], licensedPhotoApi: adapter })).evidence.origin, 'licensed_photo_api');
  assert.equal(calls, 1);
  assert.equal((await resolve({ assets: [], licensedPhotoApi: { ...adapter, search: async () => { throw new Error('unavailable'); } } })).mode, 'typography');
});
