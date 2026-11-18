import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import pkg from 'pg';
import sharp from '../../render/node_modules/sharp/lib/index.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const storagePath = process.env.GAPURA_TEST_STORAGE;
const pool = enabled ? new pkg.Pool({
  host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER,
  password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME,
}) : null;
const headers = { 'Content-Type': 'application/json' };
const post = (route, body) => fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });

test.before(() => {
  if (enabled) {
    assert.equal(process.env.NODE_ENV, 'test');
    assert.match(process.env.HME_DB_NAME, /^gapura_test_/);
    assert.equal(process.env.GAPURA_DISABLE_WORKERS, 'true');
  }
});
test.after(async () => { if (pool) await pool.end(); });

async function topic(t, name = 'Layanan publik untuk warga') {
  const { rows: [row] } = await pool.query(
    "INSERT INTO topics(title,summary,url,primary_source) VALUES($1,'Ringkasan fixture','https://example.org/rilis','Dinas') RETURNING id,url",
    [name],
  );
  t.after(async () => {
    await pool.query('DELETE FROM publication_targets WHERE draft_id IN (SELECT id FROM drafts WHERE topic_id=$1)', [row.id]);
    await pool.query('DELETE FROM scheduled_posts WHERE draft_id IN (SELECT id FROM drafts WHERE topic_id=$1)', [row.id]);
    await pool.query('DELETE FROM drafts WHERE topic_id=$1', [row.id]);
    await pool.query('DELETE FROM topics WHERE id=$1', [row.id]);
  });
  return row;
}

let rasterData;
test.before(async () => {
  const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#1f7e81' } }).png().toBuffer();
  rasterData = `data:image/png;base64,${png.toString('base64')}`;
});

function uploadBody(overrides = {}) {
  return {
    filename: 'cover-dokumentasi.png', data_uri: rasterData, credit: 'Dokumentasi Gapura Media',
    rights_basis: 'own_work', rights_reference: '', rights_attested: true, ...overrides,
  };
}

async function upload(t, topicId, overrides = {}) {
  const response = await post(`/api/topics/${topicId}/media`, uploadBody(overrides));
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

async function customDraft(t, item, { slides, format = 'single' } = {}) {
  const response = await post('/api/drafts/create-from-custom', {
    topic_id: Number(item.id), title: 'Penjelasan layanan publik', primary_source: 'Dinas', source_url: item.url,
    slides: slides || [{ no: 1, layout: 'cover-focus', teks: 'Ringkasan layanan untuk warga', data: { title: 'Ringkasan layanan untuk warga' } }],
    caption: 'Naskah custom Gapura yang sudah ditulis redaksi.', hashtags: ['#GapuraMedia'], format,
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).draft_id;
}

test('a manual cover can be uploaded, pinned to slide 1 and approved as a new revision', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const uploaded = await upload(t, item.id);
  assert.equal(uploaded.descriptor.image_kind, 'editor_upload');
  assert.equal(uploaded.descriptor.credit, 'Dokumentasi Gapura Media');
  assert.match(uploaded.descriptor.asset_sha256, /^[a-f0-9]{64}$/);
  const stored = (await pool.query('SELECT * FROM manual_media_assets WHERE id=$1', [uploaded.descriptor.asset_id])).rows[0];
  assert.equal(stored.topic_id, item.id);
  assert.equal(stored.rights_basis, 'own_work');
  const file = path.join(storagePath, stored.local_path);
  assert.ok((await fs.stat(file)).size > 0);
  assert.equal(file, path.join(storagePath, 'media', 'manual', `${stored.id}.jpg`));

  const draftId = await customDraft(t, item);
  let draft = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draftId])).rows[0];
  const beforeCover = await fetch(`${base}/api/drafts/${draftId}`, { headers }).then((response) => response.json());
  const blocked = await post(`/api/drafts/${draftId}/approve`, { mode: 'auto', reviewed: true, expected_revision: beforeCover.revision });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /Cover/);

  const attachment = await post(`/api/drafts/${draftId}/slide-media`, { slide_no: 1, asset_id: uploaded.descriptor.asset_id });
  assert.equal(attachment.status, 200, await attachment.clone().text());
  draft = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draftId])).rows[0];
  assert.equal(draft.slides[0].data.image_kind, 'editor_upload');
  assert.equal(draft.slides[0].data.asset_id, uploaded.descriptor.asset_id);
  assert.equal(draft.slides[0].data.credit, 'Dokumentasi Gapura Media');
  assert.equal(draft.slides[0].data.image_data, undefined);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.needs_review, true);
  assert.ok((await fs.stat(path.join(storagePath, 'drafts', String(draftId), 'slide_1.png'))).size > 0);

  const detail = await fetch(`${base}/api/drafts/${draftId}`, { headers }).then((response) => response.json());
  const approved = await post(`/api/drafts/${draftId}/approve`, { mode: 'auto', reviewed: true, expected_revision: detail.revision });
  assert.equal(approved.status, 200, await approved.clone().text());
  assert.equal((await pool.query('SELECT status FROM drafts WHERE id=$1', [draftId])).rows[0].status, 'scheduled');

  const replacement = await upload(t, item.id, { credit: 'Dokumentasi lapangan Gapura' });
  const replaced = await post(`/api/drafts/${draftId}/slide-media`, { slide_no: 1, asset_id: replacement.descriptor.asset_id });
  assert.equal(replaced.status, 200, await replaced.clone().text());
  draft = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draftId])).rows[0];
  assert.equal(draft.slides[0].data.asset_id, replacement.descriptor.asset_id);
  assert.equal(draft.slides[0].data.credit, 'Dokumentasi lapangan Gapura');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.needs_review, true);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM scheduled_posts WHERE draft_id=$1 AND status='failed'", [draftId])).rows[0].n, 1);
});

test('body slides accept an optional manual image without forcing a cover image', { skip: !enabled }, async (t) => {
  const item = await topic(t, 'Catatan layanan wilayah');
  const uploaded = await upload(t, item.id);
  const slides = [1, 2, 3].map((no) => ({ no, layout: 'big-statement', teks: `Poin ${no} layanan warga`, data: { title: `Poin ${no}` } }));
  const draftId = await customDraft(t, item, { slides, format: 'carousel' });
  const attached = await post(`/api/drafts/${draftId}/slide-media`, { slide_no: 2, asset_id: uploaded.descriptor.asset_id });
  assert.equal(attached.status, 200, await attached.clone().text());
  const draft = (await pool.query('SELECT * FROM drafts WHERE id=$1', [draftId])).rows[0];
  assert.equal(draft.slides[0].data.asset_id, undefined);
  assert.equal(draft.slides[1].data.asset_id, uploaded.descriptor.asset_id);
  assert.equal(draft.slides[1].layout, 'illustration');
  const detail = await fetch(`${base}/api/drafts/${draftId}`, { headers }).then((response) => response.json());
  const blocked = await post(`/api/drafts/${draftId}/approve`, { mode: 'auto', reviewed: true, expected_revision: detail.revision });
  assert.equal(blocked.status, 409);
  assert.match((await blocked.json()).error, /Cover/);
});

test('uploads and cover pinning enforce provenance, ownership and bounded input', { skip: !enabled }, async (t) => {
  const item = await topic(t);
  const other = await topic(t, 'Topik lain');
  for (const [body, message] of [
    [uploadBody({ rights_attested: false }), /hak/],
    [uploadBody({ credit: '   ' }), /Credit/],
    [uploadBody({ rights_basis: 'borrowed' }), /hak/],
    [uploadBody({ data_uri: 'data:image/svg+xml;base64,PHN2Zy8+' }), /data_uri|gambar/],
    [uploadBody({ unexpected: true }), /field/],
  ]) {
    const response = await post(`/api/topics/${item.id}/media`, body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.match((await response.json()).error, message);
  }
  const foreign = await upload(t, other.id);
  const draftId = await customDraft(t, item);
  const rejected = await post(`/api/drafts/${draftId}/slide-media`, { slide_no: 1, asset_id: foreign.descriptor.asset_id });
  assert.equal(rejected.status, 409);
  const missing = await fetch(`${base}/api/drafts/${draftId}`, { headers }).then((response) => response.json());
  assert.equal(missing.slides[0].data.asset_id, undefined);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM manual_media_assets WHERE topic_id=$1', [item.id])).rows[0].n, 0);
});
