import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pkg from 'pg';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import { createIllustrationService } from '../../designer/illustration-store.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const headers = { 'Content-Type': 'application/json' };
const currentInput = { version: 1, mode: 'current', facts: [
  { id: 'service', text: 'Layanan dibuka kembali untuk warga setelah proses perbaikan fasilitas selesai.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
  { id: 'access', text: 'Warga dapat mengakses layanan melalui kantor kecamatan sesuai jadwal yang berlaku.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
  { id: 'requirements', text: 'Petugas memberikan penjelasan mengenai persyaratan dan dokumen yang perlu disiapkan.', source_url: 'https://example.org/rilis', source_name: 'Dinas' },
] };
const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
test.before(() => { if (enabled) { assert.equal(process.env.NODE_ENV, 'test'); assert.match(process.env.HME_DB_NAME, /^gapura_test_/); assert.equal(process.env.GAPURA_DISABLE_WORKERS, 'true'); } });
test.after(async () => { if (pool) await pool.end(); });

async function seed(t) {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,summary,primary_source,url,status) VALUES('Membaca layanan publik','PUBLISHER_SUMMARY_SENTINEL','Dinas','https://example.org/radar','scored') RETURNING *");
  await pool.query("INSERT INTO topic_scores(topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model) VALUES($1,30,25,20,10,10,95,'passed','fixture')", [topic.id]);
  const illustrations = createIllustrationService({ pool, storagePath: process.env.GAPURA_TEST_STORAGE, generate: async () => ({
    bytes: await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f7e81' } }).png().toBuffer(), mime: 'image/png', provider: 'gemini', model: 'fixture-image', prompt: 'Ilustrasi konseptual Gapura', rights_reference: 'https://ai.google.dev/gemini-api/terms',
  }) });
  const { asset } = await illustrations.generate(topic.id, { request_id: randomUUID() });
  t.after(async () => { await pool.query('DELETE FROM prompt_jobs WHERE topic_id=$1', [topic.id]); await pool.query('DELETE FROM drafts WHERE topic_id=$1', [topic.id]); await pool.query('DELETE FROM topics WHERE id=$1', [topic.id]); });
  return { ...topic, illustration: asset };
}

test('custom generation returns a complete original explainer or current carousel and blocks invalid curated inputs', { skip: !enabled }, async () => {
  for (const editorial_input of [{ mode: 'explainer', facts: [] }, currentInput]) {
    const response = await post('/api/designer/generate-slides', { title: 'Memahami layanan publik', summary: 'PUBLISHER_SUMMARY_SENTINEL', body: 'PUBLISHER_BODY_SENTINEL', image_url: 'https://example.org/PUBLISHER_PHOTO_SENTINEL', url: 'https://example.org/radar', editorial_input });
    assert.equal(response.status, 200, await response.clone().text());
    const content = await response.json();
    assert.equal(content.format, 'carousel');
    assert.equal(content.slides.length, 6);
    assert.equal(content.editorial_mode, editorial_input.mode);
    assert.equal(content.editorial_input.version, 1);
    assert.ok(content.caption_body.length >= 1200 && content.caption_body.length <= 1900);
    assert.ok(content.threads_caption.length <= 500);
    assert.ok(content.angle && content.scope_note);
    assert.equal(content.needs_review, true);
    assert.doesNotMatch(JSON.stringify(content), /PUBLISHER_SUMMARY_SENTINEL|PUBLISHER_BODY_SENTINEL|PUBLISHER_PHOTO_SENTINEL/);
  }
  for (const editorial_input of [{ mode: 'current', facts: [] }, { mode: 'explainer', facts: currentInput.facts }, { mode: 'explainer', body: 'forbidden' }, { mode: 'current', facts: [{ ...currentInput.facts[0], source_url: 'https://localhost/private' }] }]) {
    const response = await post('/api/designer/generate-slides', { title: 'Memahami layanan', url: 'https://example.org/radar', editorial_input });
    assert.equal(response.status, 422, await response.clone().text());
    assert.doesNotMatch((await response.json()).error, /stack|api[_ -]?key|PUBLISHER|original_/i);
  }
  const failed = await post('/api/designer/generate-slides', { title: 'FIXTURE_GENERATION_ERROR', url: 'https://example.org/radar' });
  assert.equal(failed.status, 422, await failed.clone().text());
});

test('Studio stores normalized seed input in plan and requires reviewed full plans before production', { skip: !enabled }, async (t) => {
  const topic = await seed(t);
  await pool.query('UPDATE topics SET summary=NULL WHERE id=$1', [topic.id]);
  const response = await post('/api/studio/jobs', { prompt: 'Jelaskan mekanisme akses layanan publik', topic_id: Number(topic.id), editorial_input: currentInput });
  assert.equal(response.status, 200, await response.clone().text());
  const { job } = await response.json();
  assert.deepEqual(job.plan, { editorial_input: currentInput });
  const run = await post(`/api/studio/jobs/${job.id}/run`, {});
  assert.equal(run.status, 200);
  let reviewed;
  for (let attempt = 0; attempt < 100; attempt++) {
    reviewed = (await pool.query('SELECT * FROM prompt_jobs WHERE id=$1', [job.id])).rows[0];
    if (reviewed.status === 'plan_review' || reviewed.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(reviewed.status, 'plan_review', reviewed.error);
  assert.equal(reviewed.draft_id, null);
  assert.equal(reviewed.plan.format, 'carousel');
  assert.equal(reviewed.plan.slide_count_hint, 6);
  assert.deepEqual(reviewed.plan.editorial_input, currentInput);
  const invalid = await post(`/api/studio/jobs/${job.id}/plan`, { plan: { ...reviewed.plan, editorial_input: { mode: 'current', facts: [] } } });
  assert.equal(invalid.status, 422, await invalid.clone().text());
});

test('custom R6 save validates carousel and mode, persists authored caption metadata, and keeps current input on regeneration', { skip: !enabled }, async (t) => {
  const topic = await seed(t);
  const generation = await post('/api/designer/generate-slides', { title: topic.title, url: topic.url, editorial_input: currentInput });
  assert.equal(generation.status, 200, await generation.clone().text());
  const content = await generation.json();
  const descriptor = { asset_id: topic.illustration.id, asset_sha256: topic.illustration.sha256, image_kind: 'ai_generated', disclosure_version: 1 };
  const body = { ...content, title: topic.title, topic_id: Number(topic.id), source_url: topic.url, primary_source: topic.primary_source,
    slides: content.slides.map((slide, index) => index ? slide : { ...slide, data: { ...slide.data, ...descriptor } }) };
  for (const invalid of [{ ...body, slides: content.slides.slice(0, 2) }, { ...body, slides: [null, ...content.slides.slice(1)] }, { ...body, format: 'single' }, { ...body, editorial_mode: 'explainer' }, { ...body, caption_body: 'Too short' }, { ...body, editorial_references: undefined }, { ...body, editorial_references: { ...content.editorial_references, caption: [{ kind: 'fact', fact_ids: ['unknown'] }, ...content.editorial_references.caption.slice(1)] } }]) {
    const response = await post('/api/drafts/create-from-custom', invalid);
    assert.equal(response.status, 422, await response.clone().text());
  }
  const photo = await post('/api/drafts/create-from-custom', { ...body, slides: body.slides.map((slide, index) => index ? slide : { ...slide, data: { ...slide.data, image_url: 'https://img.antaranews.com/PUBLISHER_PHOTO_SENTINEL.jpg' } }) });
  assert.equal(photo.status, 422, await photo.clone().text());
  for (const replacement of [{ asset_id: randomUUID() }, { asset_sha256: '0'.repeat(64) }]) {
    const response = await post('/api/drafts/create-from-custom', { ...body, slides: body.slides.map((slide, index) => index ? slide : { ...slide, data: { ...slide.data, ...replacement } }) });
    assert.equal(response.status, 409, await response.clone().text());
  }
  const saved = await post('/api/drafts/create-from-custom', body);
  assert.equal(saved.status, 200, await saved.clone().text());
  const { draft_id } = await saved.json();
  const detail = await (await fetch(`${base}/api/drafts/${draft_id}`)).json();
  assert.equal(detail.caption, content.caption);
  assert.equal(detail.caption_body, content.caption_body);
  assert.equal(detail.threads_caption, content.threads_caption);
  assert.deepEqual(detail.editorial_input, currentInput);
  assert.equal(detail.editorial_mode, 'current');
  assert.equal(detail.angle, content.angle);
  assert.equal(detail.scope_note, content.scope_note);
  assert.deepEqual(detail.editorial_references, content.editorial_references);
  assert.equal(detail.slides[0].data.asset_id, descriptor.asset_id);
  assert.equal(detail.slides[0].data.asset_sha256, descriptor.asset_sha256);
  const invalid = await post(`/api/drafts/${draft_id}/regenerate-ai`, { editorial_input: { mode: 'current', facts: [] } });
  assert.equal(invalid.status, 422, await invalid.clone().text());
  const regenerated = await post(`/api/drafts/${draft_id}/regenerate-ai`, {});
  assert.equal(regenerated.status, 200, await regenerated.clone().text());
  const current = await regenerated.json();
  assert.equal(current.editorial_mode, 'current');
  assert.deepEqual(current.editorial_input, currentInput);
  assert.equal(current.needs_review, true);
  const changed = await post(`/api/drafts/${draft_id}/regenerate-ai`, { editorial_input: { mode: 'explainer', facts: [] } });
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await changed.json()).editorial_mode, 'explainer');
  const stale = await post(`/api/drafts/${draft_id}/approve`, { mode: 'auto', reviewed: true, expected_revision: detail.revision });
  assert.equal(stale.status, 409);
});

test('unmarked custom news never defaults to a one/two slide draft', { skip: !enabled }, async () => {
  for (const count of [1, 2]) {
    const response = await post('/api/drafts/create-from-custom', { title: 'New original news', source_url: 'https://example.org/radar', slides: Array.from({ length: count }, (_, index) => ({ no: index + 1, layout: index ? 'big-statement' : 'cover-focus', teks: `Slide ${index}`, data: {} })) });
    assert.equal(response.status, 422, await response.clone().text());
  }
});

test('headline-only source generation fails closed and never creates a short-caption draft', { skip: !enabled }, async (t) => {
  const topic = await seed(t);
  const response = await post(`/api/topics/${topic.id}/auto-produce`, {});
  assert.equal(response.status, 422, await response.clone().text());
  assert.match((await response.json()).error, /domain sumber|tiga fakta/i);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM drafts WHERE topic_id=$1', [topic.id])).rows[0].n, 0);
});

test('legacy Studio short-copy drafts cannot be approved even with a current cover and revision hash', { skip: !enabled }, async (t) => {
  const topic = await seed(t);
  const cover = { no: 1, layout: 'cover-focus', teks: topic.title, data: {
    title: topic.title, asset_id: topic.illustration.id, asset_sha256: topic.illustration.sha256,
    image_kind: 'ai_generated', disclosure_version: 1,
  } };
  const slides = [cover, { no: 2, layout: 'big-statement', teks: 'Layanan dibuka kembali.' }];
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,content_format,copy_model,status,needs_review) VALUES($1,$2,'Caption pendek','carousel','studio-ai-designer','draft',true) RETURNING id", [topic.id, JSON.stringify(slides)]);
  const detail = await (await fetch(`${base}/api/drafts/${draft.id}`)).json();
  const response = await post(`/api/drafts/${draft.id}/approve`, { mode: 'auto', reviewed: true, expected_revision: detail.revision });
  assert.equal(response.status, 409, await response.clone().text());
  assert.match((await response.json()).error, /kontrak berita bersumber/i);
  assert.equal((await pool.query('SELECT status FROM drafts WHERE id=$1', [draft.id])).rows[0].status, 'draft');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM scheduled_posts WHERE draft_id=$1', [draft.id])).rows[0].n, 0);
});

test('normal production rejects invalid current input and generation failure never becomes a source-copy draft', { skip: !enabled }, async (t) => {
  const topic = await seed(t);
  const invalid = await post(`/api/topics/${topic.id}/auto-produce`, { editorial_input: { mode: 'current', facts: [] } });
  assert.equal(invalid.status, 422, await invalid.clone().text());
  await pool.query("UPDATE topics SET title='FIXTURE_GENERATION_ERROR' WHERE id=$1", [topic.id]);
  const failed = await post(`/api/topics/${topic.id}/auto-produce`, { editorial_input: currentInput });
  assert.equal(failed.status, 422, await failed.clone().text());
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM drafts WHERE topic_id=$1', [topic.id])).rows[0].n, 0);
  await pool.query('UPDATE topics SET title=$2,summary=NULL WHERE id=$1', [topic.id, topic.title]);
  const produced = await post(`/api/topics/${topic.id}/auto-produce`, { editorial_input: currentInput });
  assert.equal(produced.status, 200, await produced.clone().text());
  const { draft_id } = await produced.json();
  const before = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draft_id])).rows[0];
  assert.equal(before.editorial_mode, 'current');
  assert.deepEqual(before.editorial_input, currentInput);
  await pool.query("UPDATE topics SET title='FIXTURE_GENERATION_ERROR' WHERE id=$1", [topic.id]);
  const regeneration = await post(`/api/drafts/${draft_id}/regenerate-ai`, {});
  assert.equal(regeneration.status, 422, await regeneration.clone().text());
  const after = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draft_id])).rows[0];
  assert.equal(after.caption, before.caption);
  assert.deepEqual(after.slides, before.slides);
  assert.deepEqual(after.editorial_input, currentInput);
});
