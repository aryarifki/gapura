import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import pkg from 'pg';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import { createIllustrationService } from '../../designer/illustration-store.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const storagePath = process.env.GAPURA_TEST_STORAGE;
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const headers = { 'Content-Type': 'application/json' };
test.before(() => { if (enabled) { assert.equal(process.env.NODE_ENV, 'test'); assert.match(process.env.HME_DB_NAME, /^gapura_test_/); } });
test.after(async () => { if (pool) await pool.end(); });
async function topic(t) {
  const { rows: [row] } = await pool.query("INSERT INTO topics(title,summary,url,primary_source) VALUES('Layanan publik untuk warga','BODY_MUST_NOT_ENTER_IMAGE','https://example.org/a','Fixture') RETURNING *");
  t.after(async () => { await pool.query('DELETE FROM drafts WHERE topic_id=$1', [row.id]); await pool.query('DELETE FROM topics WHERE id=$1', [row.id]); });
  return row;
}
const mockGenerate = async () => ({ bytes: await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f7e81' } }).png().toBuffer(), mime: 'image/png', provider: 'gemini', model: 'fixture-image', prompt: 'Ilustrasi konseptual Gapura', generation_id: 'fixture', rights_reference: 'https://ai.google.dev/gemini-api/terms' });

test('illustration migration is additive/idempotent; service stores immutable raster and idempotent requests', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const migration = await fs.readFile(new URL('../../../database/migrations/20261117_ai_illustrations.sql', import.meta.url), 'utf8');
  await pool.query(migration); await pool.query(migration);
  const requestId = randomUUID(); let calls = 0;
  const service = createIllustrationService({ pool, storagePath, generate: async (input) => { calls++; assert.equal(input.summary, undefined); assert.equal(input.image_url, undefined); return mockGenerate(); } });
  const first = await service.generate(item.id, { request_id: requestId });
  assert.equal(first.asset.status, 'ready');
  assert.equal(first.asset.kind, 'ai_generated');
  assert.equal(first.asset.disclosure, 'Ilustrasi AI · Gapura Media');
  assert.equal(first.is_existing, false);
  assert.equal((await service.generate(item.id, { request_id: requestId })).is_existing, true);
  const reusedRequest = randomUUID();
  assert.equal((await service.generate(item.id, { request_id: reusedRequest })).asset.id, first.asset.id);
  assert.equal(calls, 1);
  const saved = (await service.list(item.id)).selected;
  assert.equal(saved.id, first.asset.id);
  assert.equal(saved.local_path, `media/${first.asset.id}.png`);
  const historical = (await pool.query('SELECT * FROM topics WHERE id=$1', [item.id])).rows[0];
  assert.equal(historical.summary, item.summary);
  assert.equal(historical.updated_at.toISOString(), item.updated_at.toISOString());
  const regenerated = await service.generate(item.id, { request_id: randomUUID(), regenerate: true });
  assert.notEqual(regenerated.asset.id, first.asset.id);
  assert.equal((await service.generate(item.id, { request_id: reusedRequest })).asset.id, first.asset.id, 'same request keeps its original asset even when selection changes');
  assert.equal((await service.list(item.id)).assets.length, 2);
  assert.deepEqual(await fs.readFile(path.join(storagePath, saved.local_path)), (await mockGenerate()).bytes);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM drafts WHERE topic_id=$1', [item.id])).rows[0].n, 0);
});

test('concurrent generation is rejected without duplicated provider charge and failure preserves selected asset', { skip: !enabled }, async (t) => {
  const item = await topic(t); let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let started; const signal = new Promise((resolve) => { started = resolve; });
  const service = createIllustrationService({ pool, storagePath, generate: async () => { started(); await pending; return mockGenerate(); } });
  const running = service.generate(item.id, { request_id: randomUUID() });
  await signal;
  try { await assert.rejects(service.generate(item.id, { request_id: randomUUID() }), /illustration_busy/); }
  finally { release(); }
  const ready = await running;
  const failure = createIllustrationService({ pool, storagePath, generate: async () => { throw new Error('SECRET_UPSTREAM_CONTENT'); } });
  const requestId = randomUUID();
  const failed = await failure.generate(item.id, { request_id: requestId, regenerate: true });
  assert.equal(failed.asset.status, 'failed');
  assert.equal(failed.asset.error_code, 'illustration_generation_failed');
  assert.doesNotMatch(JSON.stringify(failed), /SECRET_UPSTREAM_CONTENT/);
  assert.equal((await failure.list(item.id)).selected.id, ready.asset.id);
  assert.equal((await failure.generate(item.id, { request_id: requestId, regenerate: true })).asset.id, failed.asset.id);
});

test('illustration API exposes list and inline raster; Origin, UUID and request body are validated', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const list = await fetch(`${base}/api/topics/${item.id}/illustration`);
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).assets, []);
  for (const body of [{}, { request_id: '../escape' }, { request_id: randomUUID(), url: 'https://localhost/a' }, { request_id: randomUUID(), regenerate: 'yes' }]) {
    const r = await fetch(`${base}/api/topics/${item.id}/illustration/generate`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(r.status, 400, await r.clone().text());
  }
  const rejected = await fetch(`${base}/api/topics/${item.id}/illustration/generate`, { method: 'POST', headers: { ...headers, Origin: 'https://other.example.org' }, body: JSON.stringify({ request_id: randomUUID() }) });
  assert.equal(rejected.status, 403);
  const generate = await fetch(`${base}/api/topics/${item.id}/illustration/generate`, { method: 'POST', headers, body: JSON.stringify({ request_id: randomUUID() }) });
  assert.equal(generate.status, 200, await generate.clone().text());
  const packet = await generate.json();
  assert.equal(packet.asset.status, 'ready');
  const raster = await fetch(`${base}/api/media/assets/${packet.asset.id}`);
  assert.equal(raster.status, 200);
  assert.equal(raster.headers.get('content-type'), 'image/png');
  assert.equal(raster.headers.get('x-content-type-options'), 'nosniff');
  assert.ok((await raster.arrayBuffer()).byteLength > 0);
  assert.equal((await fetch(`${base}/api/media/assets/not-a-uuid`)).status, 400);
  assert.equal((await fetch(`${base}/api/media/assets/${randomUUID()}`)).status, 404);
  assert.equal((await fetch(`${base}/api/topics/9000000000000000/illustration`)).status, 404);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM topic_materials WHERE topic_id=$1', [item.id])).rows[0].n, 0);
});

test('draft edit and preview hydrate/preserve asset IDs and hashes; export includes the rendered illustration', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const service = createIllustrationService({ pool, storagePath, generate: mockGenerate });
  const { asset } = await service.generate(item.id, { request_id: randomUUID() });
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Penjelasan Gapura', data: { title: 'Penjelasan Gapura', asset_id: asset.id, asset_sha256: asset.sha256, image_kind: 'ai_generated', disclosure_version: 1 } }];
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,copy_model,status) VALUES($1,$2,'Caption Gapura','fixture','draft') RETURNING *", [item.id, JSON.stringify(slides)]);
  t.after(() => pool.query('DELETE FROM drafts WHERE id=$1', [draft.id]));
  const edit = await fetch(`${base}/api/drafts/${draft.id}/edit-slide`, { method: 'POST', headers, body: JSON.stringify({ slide_no: 1, new_text: 'Penjelasan diperbarui', data: { title: 'Penjelasan diperbarui', image_disclosure: 'foto' } }) });
  assert.equal(edit.status, 200, await edit.clone().text());
  const detail = await (await fetch(`${base}/api/drafts/${draft.id}`)).json();
  assert.equal(detail.slides[0].data.asset_id, asset.id);
  assert.equal(detail.slides[0].data.asset_sha256, asset.sha256);
  assert.equal(detail.slides[0].data.image_kind, 'ai_generated');
  assert.equal(detail.slides[0].data.image_data, undefined);
  const preview = await fetch(`${base}/api/render/preview`, { method: 'POST', headers, body: JSON.stringify({ slide: detail.slides[0], slide_no: 1, total_slides: 1 }) });
  assert.equal(preview.status, 200, await preview.clone().text());
  assert.equal(preview.headers.get('content-type'), 'image/png');
  const exported = await fetch(`${base}/api/drafts/${draft.id}/export`);
  assert.equal(exported.status, 200);
  assert.ok((await exported.arrayBuffer()).byteLength > 10000);
  const other = await topic(t);
  const foreign = await service.generate(other.id, { request_id: randomUUID() });
  const changed = await fetch(`${base}/api/drafts/${draft.id}/edit-slide`, { method: 'POST', headers, body: JSON.stringify({ slide_no: 1, teks: 'Bad replacement', data: { asset_id: foreign.asset.id } }) });
  assert.equal(changed.status, 409);
  assert.equal((await pool.query('SELECT slides FROM drafts WHERE id=$1', [draft.id])).rows[0].slides[0].data.asset_id, asset.id);
});

test('production without verification reports pins the selected illustration and preserves it on text regeneration', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  await pool.query("UPDATE topics SET status='scored' WHERE id=$1", [item.id]);
  await pool.query("INSERT INTO topic_scores(topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model) VALUES($1,30,25,20,10,10,95,'passed','fixture')", [item.id]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM verification_reports WHERE topic_id=$1', [item.id])).rows[0].n, 0);
  const service = createIllustrationService({ pool, storagePath, generate: mockGenerate });
  const first = await service.generate(item.id, { request_id: randomUUID() });
  const response = await fetch(`${base}/api/topics/${item.id}/auto-produce`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 200, await response.clone().text());
  const produced = await response.json();
  const draft = (await pool.query('SELECT * FROM drafts WHERE id=$1', [produced.draft_id])).rows[0];
  assert.equal(draft.slides[0].data.asset_id, first.asset.id);
  const second = await service.generate(item.id, { request_id: randomUUID(), regenerate: true });
  const regeneration = await fetch(`${base}/api/drafts/${draft.id}/regenerate-ai`, { method: 'POST', headers, body: '{}' });
  assert.equal(regeneration.status, 200, await regeneration.clone().text());
  const current = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id])).rows[0];
  assert.equal(current.slides[0].data.asset_id, first.asset.id);
  assert.equal(current.slides[0].data.asset_sha256, first.asset.sha256);
  const replacement = await fetch(`${base}/api/drafts/${draft.id}/illustration`, { method: 'POST', headers, body: JSON.stringify({ asset_id: second.asset.id }) });
  assert.equal(replacement.status, 200, await replacement.clone().text());
  const replaced = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id])).rows[0];
  assert.equal(replaced.slides[0].data.asset_id, second.asset.id);
  assert.equal(replaced.status, 'draft');
  assert.equal(replaced.needs_review, true);
});

test('missing or failed illustration blocks production before a text-only draft is written', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  await pool.query("UPDATE topics SET status='scored' WHERE id=$1", [item.id]);
  await pool.query("INSERT INTO topic_scores(topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model) VALUES($1,30,25,20,10,10,95,'passed','fixture')", [item.id]);
  const service = createIllustrationService({ pool, storagePath, generate: async () => { throw new Error('illustration_provider_http_429'); } });
  await service.generate(item.id, { request_id: randomUUID() });
  const response = await fetch(`${base}/api/topics/${item.id}/auto-produce`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /needs_media/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM drafts WHERE topic_id=$1', [item.id])).rows[0].n, 0);
});

test('deleting a text slide does not copy its following illustration onto another text slide', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const service = createIllustrationService({ pool, storagePath, generate: mockGenerate });
  const { asset } = await service.generate(item.id, { request_id: randomUUID() });
  const descriptor = { asset_id: asset.id, asset_sha256: asset.sha256, image_kind: 'ai_generated', disclosure_version: 1 };
  const slides = [
    { no: 1, layout: 'cover-focus', teks: 'Cover', data: { ...descriptor } },
    { no: 2, layout: 'big-statement', teks: 'Teks dihapus', data: {} },
    { no: 3, layout: 'illustration', teks: 'Penjelasan bergambar', data: { ...descriptor } },
    { no: 4, layout: 'big-statement', teks: 'Teks tetap', data: {} },
  ];
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,copy_model,status) VALUES($1,$2,'Caption','fixture','draft') RETURNING id", [item.id, JSON.stringify(slides)]);
  const response = await fetch(`${base}/api/drafts/${draft.id}/delete-slide`, { method: 'POST', headers, body: JSON.stringify({ slide_no: 2 }) });
  assert.equal(response.status, 200, await response.clone().text());
  const saved = (await pool.query('SELECT slides FROM drafts WHERE id=$1', [draft.id])).rows[0].slides;
  assert.equal(saved.length, 3);
  assert.equal(saved[1].data.asset_id, asset.id);
  assert.equal(saved[2].data.asset_id, undefined);
});

test('custom design can pin a selected topic illustration before inserting/rendering and refuses foreign assets', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const service = createIllustrationService({ pool, storagePath, generate: mockGenerate });
  const { asset } = await service.generate(item.id, { request_id: randomUUID() });
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Penjelasan orisinal custom', data: { title: 'Penjelasan custom' } }];
  const body = { topic_id: Number(item.id), title: 'Penjelasan custom', source_url: item.url, slides, caption: 'Naskah custom Gapura', hashtags: ['#GapuraMedia'], format: 'single' };
  const response = await fetch(`${base}/api/drafts/create-from-custom`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  const saved = (await pool.query('SELECT * FROM drafts WHERE id=$1', [result.draft_id])).rows[0];
  assert.equal(saved.topic_id, item.id);
  assert.equal(saved.slides[0].data.asset_id, asset.id);
  assert.equal(saved.slides[0].data.image_data, undefined);
  const other = await topic(t);
  const invalid = await fetch(`${base}/api/drafts/create-from-custom`, { method: 'POST', headers, body: JSON.stringify({ ...body, topic_id: Number(other.id), slides: [{ ...slides[0], data: { asset_id: asset.id } }] }) });
  assert.equal(invalid.status, 409);
  const missing = await fetch(`${base}/api/drafts/create-from-custom`, { method: 'POST', headers, body: JSON.stringify({ ...body, topic_id: Number(other.id) }) });
  assert.equal(missing.status, 200, await missing.clone().text());
  const { rows: [uncovered] } = await pool.query('SELECT slides FROM drafts WHERE topic_id=$1', [other.id]);
  assert.equal(uncovered.slides[0].data.asset_id, undefined);
});
