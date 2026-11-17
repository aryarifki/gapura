import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import { buildIllustrationPrompt, generateIllustration, saveIllustrationRaster, readIllustrationRaster, orphanIllustrationFiles } from '../illustrations.js';

const config = { designer: { provider: 'gemini', image_generation: { enabled: true, provider: 'gemini', model: 'gemini-3.1-flash-lite-image', rights_reference: 'https://ai.google.dev/gemini-api/terms', timeout_ms: 90000 } } };
const providers = { providers: { gemini: { kind: 'gemini', base_url: 'https://generativelanguage.googleapis.com', api_key_env: 'GEMINI_API_KEY', enabled: true } } };
const topic = { id: 1, title: 'Cara kerja layanan publik', summary: 'BODY_SENTINEL', content_html: '<p>BODY_SENTINEL</p>', image_url: 'https://img.antaranews.com/PHOTO_SENTINEL.jpg', category: 'sosial', url: 'https://example.org/news' };
const png = () => sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f7e81' } }).png().toBuffer();

test('illustration prompt uses topic/title metadata only and requests original conceptual art', () => {
  const prompt = buildIllustrationPrompt(topic);
  assert.match(prompt, /Cara kerja layanan publik/);
  assert.match(prompt, /konseptual|conceptual/i);
  assert.match(prompt, /dokumentasi|documentary/i);
  assert.doesNotMatch(prompt, /BODY_SENTINEL|PHOTO_SENTINEL|<p>|img\.antaranews/);
  assert.throws(() => buildIllustrationPrompt({ title: '' }), /illustration_title_invalid/);
});

test('Gemini generation sends text only without source images and returns bounded inline bytes/provenance', async () => {
  const bytes = await png();
  let request;
  const result = await generateIllustration(topic, { config, providers, secrets: { GEMINI_API_KEY: 'fixture-key' }, fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return Response.json({ responseId: 'fixture-response', modelVersion: config.designer.image_generation.model, candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: bytes.toString('base64') } }] } }] });
  } });
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.headers['x-goog-api-key'], 'fixture-key');
  assert.match(request.url, /gemini-3\.1-flash-lite-image:generateContent$/);
  assert.deepEqual(request.body.generationConfig.responseModalities, ['IMAGE']);
  assert.equal(request.body.contents[0].parts.length, 1);
  assert.doesNotMatch(JSON.stringify(request.body), /BODY_SENTINEL|PHOTO_SENTINEL|inlineData|fileData|google_search|tools/);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.generation_id, 'fixture-response');
  assert.equal(result.provider, 'gemini');
  assert.equal(result.rights_reference, config.designer.image_generation.rights_reference);
});

test('image adapter refuses disabled, unavailable, redirect, filtered, text-only and malformed responses without photo fallback', async () => {
  let called = 0;
  await assert.rejects(generateIllustration(topic, { config: {}, providers, fetchImpl: () => { called++; } }), /illustration_not_configured/);
  assert.equal(called, 0);
  const options = { config, providers, env: {}, secrets: { GEMINI_API_KEY: 'super-secret' } };
  for (const payload of [
    { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] },
    { candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'No image' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/svg+xml', data: 'PHN2Zz4=' } }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'invalid===' } }] } }] },
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ inlineData: { mimeType: 'image/png', data: (await png()).toString('base64') } }] } }] },
  ]) await assert.rejects(generateIllustration(topic, { ...options, fetchImpl: async () => Response.json(payload) }), /illustration_(blocked|no_image|response_invalid)/);
  await assert.rejects(generateIllustration(topic, { ...options, fetchImpl: async () => new Response('super-secret raw error', { status: 401 }) }), (e) => e.message === 'illustration_provider_http_401');
  await assert.rejects(generateIllustration(topic, { ...options, fetchImpl: async () => { throw new Error('super-secret'); } }), (e) => !e.message.includes('super-secret'));
});

test('raster store validates decoded image, MIME, size and local checksum without external URL', async (t) => {
  const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-r3-raster-');
  t.after(() => fs.rm(storagePath, { recursive: true, force: true }));
  const bytes = await png();
  const id = randomUUID();
  const asset = await saveIllustrationRaster(id, { bytes, mime: 'image/png' }, { storagePath });
  assert.equal(asset.local_path, `media/${id}.png`);
  assert.deepEqual([asset.width, asset.height, asset.mime], [640, 480, 'image/png']);
  assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(await readIllustrationRaster({ ...asset, id, status: 'ready', kind: 'ai_generated' }, { storagePath }), bytes);
  await fs.writeFile(path.join(storagePath, asset.local_path), 'tampered');
  await assert.rejects(readIllustrationRaster({ ...asset, id, status: 'ready', kind: 'ai_generated' }, { storagePath }), /illustration_checksum_mismatch/);
  await assert.rejects(saveIllustrationRaster('../escape', { bytes, mime: 'image/png' }, { storagePath }), /illustration_id_invalid/);
  await assert.rejects(saveIllustrationRaster(randomUUID(), { bytes: Buffer.from('<svg/>'), mime: 'image/png' }, { storagePath }), /illustration_raster_invalid/);
  await assert.rejects(saveIllustrationRaster(randomUUID(), { bytes, mime: 'image/jpeg' }, { storagePath }), /illustration_raster_invalid/);
  const tiny = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).png().toBuffer();
  await assert.rejects(saveIllustrationRaster(randomUUID(), { bytes: tiny, mime: 'image/png' }, { storagePath }), /illustration_dimensions_invalid/);
  await assert.rejects(saveIllustrationRaster(randomUUID(), { bytes: Buffer.alloc(4 * 1024 * 1024 + 1), mime: 'image/png' }, { storagePath }), /illustration_raster_invalid/);
});

test('local illustration reader rejects traversal and symlink escapes', async (t) => {
  const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-r3-raster-path-');
  t.after(() => fs.rm(storagePath, { recursive: true, force: true }));
  const id = randomUUID(), bytes = await png();
  const asset = await saveIllustrationRaster(id, { bytes, mime: 'image/png' }, { storagePath });
  await assert.rejects(readIllustrationRaster({ ...asset, id, status: 'ready', kind: 'ai_generated', local_path: '../escape.png' }, { storagePath }), /illustration_path_invalid/);
  await fs.rename(path.join(storagePath, 'media'), path.join(storagePath, 'external'));
  await fs.symlink(path.join(storagePath, 'external'), path.join(storagePath, 'media'));
  await assert.rejects(readIllustrationRaster({ ...asset, id, status: 'ready', kind: 'ai_generated' }, { storagePath }), /illustration_path_invalid/);
});

test('orphan cleanup inventories only old unreferenced immutable raster names and never deletes anything', async (t) => {
  const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-r3-orphans-');
  t.after(() => fs.rm(storagePath, { recursive: true, force: true }));
  const keptId = randomUUID(), orphanId = randomUUID(), recentId = randomUUID();
  const bytes = await png();
  const kept = await saveIllustrationRaster(keptId, { bytes, mime: 'image/png' }, { storagePath });
  const orphan = await saveIllustrationRaster(orphanId, { bytes, mime: 'image/png' }, { storagePath });
  await saveIllustrationRaster(recentId, { bytes, mime: 'image/png' }, { storagePath });
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  for (const asset of [kept, orphan]) await fs.utimes(path.join(storagePath, asset.local_path), old, old);
  await fs.writeFile(path.join(storagePath, 'media', 'do-not-touch.txt'), 'other data');
  const files = await orphanIllustrationFiles(new Set([kept.local_path]), { storagePath });
  assert.deepEqual(files.map((row) => row.local_path), [orphan.local_path]);
  assert.deepEqual(await fs.readFile(path.join(storagePath, orphan.local_path)), bytes);
});
