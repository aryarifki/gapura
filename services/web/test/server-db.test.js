import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import pkg from 'pg';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const base = process.env.GAPURA_TEST_BASE;
const headers = { 'Content-Type': 'application/json' };
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
const detail = async (id) => {
  const response = await fetch(`${base}/api/drafts/${id}`, { headers });
  assert.equal(response.status, 200);
  return response.json();
};

test('database integration: settings test and save round-trip preserve every agent and key', { skip: !enabled }, async () => {
  const before = await fetch(`${base}/api/agents/config`, { headers }).then((r) => r.json());
  const response = await post('/api/agents/config/test', { agent: 'studio', config: { studio: { ...before.studio, api_key: '', system_prompt: 'Temporary edited instruction' } }, skills: { studio: 'Temporary test rubric' }, prompt: 'Return {"ok":true}' });
  assert.equal(response.status, 200, await response.text());
  const unchanged = await fetch(`${base}/api/agents/config`, { headers }).then((r) => r.json());
  assert.equal(unchanged.studio.system_prompt, before.studio.system_prompt);
  const saved = await post('/api/agents/config', { studio: { api_key: '', system_prompt: 'Saved edited Studio policy' }, skills: { studio: '# Saved Studio rubric' } });
  assert.equal(saved.status, 200, await saved.text());
  const after = await fetch(`${base}/api/agents/config`, { headers }).then((r) => r.json());
  assert.equal(after.studio.system_prompt, 'Saved edited Studio policy');
  assert.equal(after.skills.studio, '# Saved Studio rubric');
  assert.equal(after.studio.api_key, '');
  assert.equal(after.studio.api_key_configured, true);
  assert.equal(after.designer.model, before.designer.model);
});

test('database integration: edited drafts cancel stale schedules and cannot be auto-approved without review', { skip: !enabled }, async () => {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,summary,url,primary_source,status,verification_status) VALUES('Fixture news','Fixture summary','https://www.bps.go.id/fixture','BPS','produced','verified') RETURNING id");
  await pool.query("INSERT INTO verification_reports(topic_id,status,confidence) VALUES($1,'verified',95)", [topic.id]);
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Original headline', data: { title: 'Original headline' } }];
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,needs_review,copy_model,content_format) VALUES($1,$2,'Fixture caption','scheduled',false,'fixture','single') RETURNING id", [topic.id, JSON.stringify(slides)]);
  await pool.query("INSERT INTO scheduled_posts(draft_id,mode,scheduled_at,status) VALUES($1,'auto',NOW()+interval '1 day','pending')", [draft.id]);
  const response = await post(`/api/drafts/${draft.id}/edit-slide`, { slide_no: 1, new_text: 'Revised headline', data: { title: 'Revised headline' } });
  assert.equal(response.status, 200, await response.text());
  const { rows: [saved] } = await pool.query('SELECT status,needs_review,slides FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.needs_review, true);
  assert.equal(saved.slides[0].teks, 'Revised headline');
  const { rows: [schedule] } = await pool.query('SELECT status FROM scheduled_posts WHERE draft_id=$1', [draft.id]);
  assert.equal(schedule.status, 'failed');
  const fresh = await detail(draft.id);
  assert.equal((await post(`/api/drafts/${draft.id}/approve`, { mode: 'auto', expected_revision: fresh.revision })).status, 409);
  const approval = { mode: 'auto', reviewed: true, expected_revision: fresh.revision };
  const responses = await Promise.all([post(`/api/drafts/${draft.id}/approve`, approval), post(`/api/drafts/${draft.id}/approve`, approval)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const { rows: [pending] } = await pool.query("SELECT count(*)::int count FROM scheduled_posts WHERE draft_id=$1 AND status='pending'", [draft.id]);
  assert.equal(pending.count, 1);
  const { rows: [audit] } = await pool.query("SELECT payload FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action='approved_auto'", [draft.id]);
  assert.match(fresh.revision, /^[a-f0-9]{64}$/);
  assert.equal(audit.payload.content_hash, fresh.revision);
  const exported = await fetch(`${base}/api/drafts/${draft.id}/export`, { headers });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-type'), /application\/zip/);
  const bytes = Buffer.from(await exported.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.ok(bytes.includes(Buffer.from('caption.txt')));
  assert.ok(bytes.includes(Buffer.from('slide_1.png')));
  const preview = await fetch(`${base}/storage/drafts/${draft.id}/slide_1.png`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('content-type'), /image\/png/);
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(`${process.env.GAPURA_TEST_STORAGE}/n8n`, { recursive: true });
  await writeFile(`${process.env.GAPURA_TEST_STORAGE}/n8n/private-fixture.txt`, 'Internal storage must not be served');
  assert.equal((await fetch(`${base}/storage/n8n/private-fixture.txt`)).status, 404);
});

test('database integration: stale browser approval after editing is rejected and fresh review succeeds', { skip: !enabled }, async (t) => {
  for (const mode of ['auto', 'manual']) await t.test(mode, async () => {
    const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,status) VALUES('Revision fixture','https://www.bps.go.id/revision-fixture','produced') RETURNING id");
    await pool.query("INSERT INTO verification_reports(topic_id,status,confidence) VALUES($1,'verified',95)", [topic.id]);
    const slides = [{ no: 1, layout: 'cover-focus', teks: 'Reviewed headline', data: { title: 'Reviewed headline' } }];
    const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,needs_review,copy_model,content_format) VALUES($1,$2,'Reviewed caption','draft',false,'fixture','single') RETURNING id", [topic.id, JSON.stringify(slides)]);
    const stale = await detail(draft.id);
    const edited = await post(`/api/drafts/${draft.id}/update-full`, { caption: 'Changed after browser review', hashtags: ['#Changed'] });
    assert.equal(edited.status, 200, await edited.text());
    const rejected = await post(`/api/drafts/${draft.id}/approve`, { mode, reviewed: true, expected_revision: stale.revision });
    assert.equal(rejected.status, 409, await rejected.text());
    const fresh = await detail(draft.id);
    assert.equal(fresh.status, 'draft');
    assert.equal(fresh.needs_review, true);
    assert.match(fresh.revision, /^[a-f0-9]{64}$/);
    assert.notEqual(fresh.revision, stale.revision);
    const { rows: [attempts] } = await pool.query("SELECT count(*)::int count FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action IN ('approved_auto','published_manual')", [draft.id]);
    assert.equal(attempts.count, 0);
    const { rows: [schedules] } = await pool.query('SELECT count(*)::int count FROM scheduled_posts WHERE draft_id=$1', [draft.id]);
    assert.equal(schedules.count, 0);
    const approved = await post(`/api/drafts/${draft.id}/approve`, { mode, reviewed: true, expected_revision: fresh.revision });
    assert.equal(approved.status, 200, await approved.text());
    const { rows: [audit] } = await pool.query("SELECT action,payload FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action IN ('approved_auto','published_manual')", [draft.id]);
    assert.equal(audit.action, mode === 'auto' ? 'approved_auto' : 'published_manual');
    assert.equal(audit.payload.content_hash, fresh.revision);
  });
});

test('database integration: both approval modes require explicit review and a current revision', { skip: !enabled }, async (t) => {
  for (const mode of ['auto', 'manual']) await t.test(mode, async () => {
    const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,status) VALUES('Review fixture','https://www.bps.go.id/review-fixture','produced') RETURNING id");
    await pool.query("INSERT INTO verification_reports(topic_id,status,confidence) VALUES($1,'verified',95)", [topic.id]);
    const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,needs_review,copy_model,content_format) VALUES($1,'[]','Review fixture','draft',false,'fixture','single') RETURNING id", [topic.id]);
    const fresh = await detail(draft.id);
    for (const reviewed of [undefined, false, 'true', 1]) {
      const response = await post(`/api/drafts/${draft.id}/approve`, { mode, reviewed, expected_revision: fresh.revision });
      assert.equal(response.status, 409, await response.text());
    }
    for (const expected_revision of [undefined, null, '', 'wrong-revision', [fresh.revision]]) {
      const response = await post(`/api/drafts/${draft.id}/approve`, { mode, reviewed: true, expected_revision });
      assert.equal(response.status, 409, await response.text());
    }
    const unchanged = await detail(draft.id);
    assert.equal(unchanged.status, 'draft');
    assert.equal(unchanged.needs_review, false);
    assert.match(unchanged.revision, /^[a-f0-9]{64}$/);
    const approved = await post(`/api/drafts/${draft.id}/approve`, { mode, reviewed: true, expected_revision: unchanged.revision });
    assert.equal(approved.status, 200, await approved.text());
  });
});

test('browser approval submits the revision of the draft being reviewed', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const approvalFunction = source.slice(source.indexOf('async function approveCurrentDraft('), source.indexOf('\nasync function rejectCurrentDraft('));
  let request;
  await runInNewContext(`${approvalFunction}\napproveCurrentDraft('auto');`, {
    activeDraft: { id: 12, revision: 'browser-reviewed-revision' },
    document: { getElementById: () => ({ checked: true }) },
    fetch: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return { ok: true, json: async () => ({}) }; },
    showToast() {}, showGalleryView() {},
  });
  assert.equal(request.url, '/api/drafts/12/approve');
  assert.deepEqual(request.body, { mode: 'auto', reviewed: true, expected_revision: 'browser-reviewed-revision' });
});

test('browser approval without a displayed revision requires reload without fetching or posting', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const approvalFunction = source.slice(source.indexOf('async function approveCurrentDraft('), source.indexOf('\nasync function rejectCurrentDraft('));
  const requests = [];
  const messages = [];
  await runInNewContext(`${approvalFunction}\napproveCurrentDraft('manual');`, {
    activeDraft: { id: 12 },
    document: { getElementById: () => ({ checked: true }) },
    fetch: async (url) => { requests.push(url); return { ok: true, json: async () => ({}) }; },
    showToast(message) { messages.push(message); }, showGalleryView() {},
  });
  assert.deepEqual(requests, []);
  assert.match(messages[0], /muat ulang/i);
});

test('database integration: rejection cannot overwrite a published draft or audit a failed rejection', { skip: !enabled }, async () => {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,status) VALUES('Published fixture','https://www.bps.go.id/published-fixture','produced') RETURNING id");
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,copy_model) VALUES($1,'[]','Published fixture','published','fixture') RETURNING id", [topic.id]);
  const response = await post(`/api/drafts/${draft.id}/reject`, { reason: 'Stale rejection' });
  assert.equal(response.status, 409, await response.text());
  const { rows: [saved] } = await pool.query('SELECT status FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(saved.status, 'published');
  const { rows: [audit] } = await pool.query("SELECT count(*)::int count FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action='rejected'", [draft.id]);
  assert.equal(audit.count, 0);
});

test('database integration: renderer failure leaves the last valid draft untouched', { skip: !enabled }, async () => {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,status) VALUES('Source','https://www.bps.go.id/fixture-2','produced') RETURNING id");
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Retained headline', data: { title: 'Retained headline' } }];
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,needs_review,copy_model) VALUES($1,$2,'Retained caption','draft',false,'fixture') RETURNING id", [topic.id, JSON.stringify(slides)]);
  const response = await post(`/api/drafts/${draft.id}/edit-slide`, { slide_no: 1, new_text: 'FIXTURE_RENDER_ERROR' });
  assert.equal(response.status, 502, await response.text());
  const { rows: [after] } = await pool.query('SELECT slides,caption,needs_review FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(after.slides[0].teks, 'Retained headline');
  assert.equal(after.caption, 'Retained caption');
  assert.equal(after.needs_review, false);
});

test('database integration: add, remove, and caption changes preserve consistent format and snapshots', { skip: !enabled }, async () => {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,status) VALUES('Editable','https://www.bps.go.id/fixture-3','produced') RETURNING id");
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Retained headline', data: { title: 'Retained headline' } }];
  const { rows: [draft] } = await pool.query("INSERT INTO drafts(topic_id,slides,caption,status,needs_review,copy_model,content_format) VALUES($1,$2,'Retained caption','draft',false,'fixture','single') RETURNING id", [topic.id, JSON.stringify(slides)]);
  const added = await post(`/api/drafts/${draft.id}/add-slide`, { layout: 'big-statement', teks: 'Additional source evidence' });
  assert.equal(added.status, 200, await added.text());
  const { rows: [afterAdd] } = await pool.query('SELECT content_format,needs_review FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(afterAdd.content_format, 'carousel');
  assert.equal(afterAdd.needs_review, true);
  assert.equal((await post(`/api/drafts/${draft.id}/delete-slide`, { slide_no: 99 })).status, 400);
  const deleted = await post(`/api/drafts/${draft.id}/delete-slide`, { slide_no: 2 });
  assert.equal(deleted.status, 200, await deleted.text());
  const { rows: [afterDelete] } = await pool.query('SELECT content_format FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(afterDelete.content_format, 'single');
  const updated = await post(`/api/drafts/${draft.id}/update-full`, { caption: 'Edited caption', hashtags: ['#GapuraMedia'] });
  assert.equal(updated.status, 200, await updated.text());
  const { rows: [saved] } = await pool.query('SELECT caption,hashtags FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(saved.caption, 'Edited caption');
  assert.deepEqual(saved.hashtags, ['#GapuraMedia']);
});

test.after(async () => { if (pool) await pool.end(); });
