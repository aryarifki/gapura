import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pkg from 'pg';
import { draftContentHash } from '../../common/draft-revision.js';
import { editDraft } from '../drafts.js';
import { createMetaPublisherWorker, publicationConfigFromEnv } from '../../publisher/meta-worker.js';
import { createPublisher } from '../../publisher/publisher.js';

const enabled = Boolean(process.env.GAPURA_TEST_BASE);
const base = process.env.GAPURA_TEST_BASE;
const pool = enabled ? new pkg.Pool({ host: process.env.HME_DB_HOST, port: process.env.HME_DB_PORT, user: process.env.HME_DB_USER, password: process.env.HME_DB_PASSWORD, database: process.env.HME_DB_NAME }) : null;
const migrationUrl = new URL('../../../database/migrations/20261117_original_editorial.sql', import.meta.url);
const metadata = {
  editorial_input: { version: 1, mode: 'explainer', facts: [] }, editorial_mode: 'explainer',
  caption_body: 'Isi asli #dalam-teks', threads_caption: 'Ringkasan Threads #GapuraMedia',
  angle: 'Akses bagi warga', scope_note: 'Penjelasan mekanisme umum',
  editorial_references: { caption: [{ kind: 'fact', fact_ids: ['f1'] }], threads: ['f1'] },
};
const headers = { 'Content-Type': 'application/json' };

test.before(() => {
  if (!enabled) return;
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.GAPURA_DISABLE_WORKERS, 'true');
  assert.match(process.env.HME_DB_NAME || '', /^gapura_test_[a-z0-9_]+$/);
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.HME_DB_HOST));
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
});
test.after(async () => { if (pool) await pool.end(); });

test('original migration declares nullable additive metadata without row rewrites or backfills', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const [field, type] of Object.entries({ editorial_input: 'JSONB', editorial_mode: 'VARCHAR\\(20\\)', caption_body: 'TEXT', threads_caption: 'TEXT', angle: 'TEXT', scope_note: 'TEXT', editorial_references: 'JSONB' })) {
    assert.match(sql, new RegExp(`ALTER TABLE drafts ADD COLUMN IF NOT EXISTS ${field} ${type}\\s*;`, 'i'));
  }
  assert.doesNotMatch(sql.replace(/--[^\n]*/g, ''), /\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE|NOT NULL|DEFAULT)\b/i);
});

test('original migration is idempotent in separate schemas and retains legacy rows, revisions and nullable defaults', { skip: !enabled }, async (t) => {
  const client = await pool.connect();
  const schema = `original_fixture_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => {
    try {
      await client.query('ROLLBACK');
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally { client.release(); }
  });
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  await client.query(`CREATE TABLE drafts(id BIGINT PRIMARY KEY, slides JSONB NOT NULL, caption TEXT NOT NULL,
    hashtags TEXT[], content_format VARCHAR(10), updated_at TIMESTAMPTZ)`);
  const { rows: [before] } = await client.query(`INSERT INTO drafts VALUES(1,'[]','Legacy caption',ARRAY['#Legacy'],'single','2026-11-16T12:00:00Z') RETURNING *,xmin::text`);
  const migration = await readFile(migrationUrl, 'utf8');
  await client.query(migration);
  await client.query(migration);
  const { rows: [legacy] } = await client.query('SELECT *,xmin::text FROM drafts WHERE id=1');
  for (const key of Object.keys(before)) assert.deepEqual(legacy[key], before[key], key);
  for (const key of Object.keys(metadata)) assert.equal(legacy[key], null, key);
  assert.equal(draftContentHash(legacy), draftContentHash(before));
  const { rows: columns } = await client.query(`SELECT column_name,data_type,is_nullable,column_default,character_maximum_length
    FROM information_schema.columns WHERE table_schema=$1 AND table_name='drafts' AND column_name=ANY($2)`, [schema, Object.keys(metadata)]);
  assert.equal(columns.length, 7);
  assert.ok(columns.every((column) => column.is_nullable === 'YES' && column.column_default === null));
  assert.equal(columns.find((column) => column.column_name === 'editorial_input').data_type, 'jsonb');
  assert.equal(columns.find((column) => column.column_name === 'editorial_references').data_type, 'jsonb');
  assert.equal(columns.find((column) => column.column_name === 'editorial_mode').character_maximum_length, 20);
  await client.query(`INSERT INTO drafts(id,slides,caption,editorial_mode,editorial_input,caption_body,threads_caption,angle,scope_note,editorial_references)
    VALUES(2,'[]','Assembled caption','explainer',$1,$2,$3,$4,$5,$6)`, [JSON.stringify(metadata.editorial_input), metadata.caption_body, metadata.threads_caption, metadata.angle, metadata.scope_note, JSON.stringify(metadata.editorial_references)]);
  await client.query("UPDATE drafts SET editorial_mode='current' WHERE id=2");
  await assert.rejects(client.query("UPDATE drafts SET editorial_mode='unsupported' WHERE id=2"), /check constraint/i);
  const { rows: snapshot } = await client.query('SELECT *,xmin::text FROM drafts ORDER BY id');
  await client.query(migration);
  assert.deepEqual((await client.query('SELECT *,xmin::text FROM drafts ORDER BY id')).rows, snapshot);
  const { rows: constraints } = await client.query("SELECT conname FROM pg_constraint WHERE conrelid='drafts'::regclass AND conname='drafts_editorial_mode_check'");
  assert.equal(constraints.length, 1);
});

function editFixture(extra = {}) {
  const draft = { id: 7, topic_id: 3, status: 'scheduled', needs_review: false,
    slides: [{ no: 1, layout: 'cover-focus', teks: 'Judul asli', data: {} },
      { no: 2, layout: 'big-statement', teks: 'Penjelasan mekanisme untuk warga', data: {} },
      { no: 3, layout: 'big-statement', teks: 'Pertimbangan penutup untuk warga', data: {} }], caption: 'Isi asli #dalam-teks\n\n#GapuraMedia',
    hashtags: ['#GapuraMedia'], content_format: 'carousel', ...structuredClone(metadata), ...extra };
  const state = { saved: structuredClone(draft), queries: [], schedule: 'pending', released: false };
  const client = { release() { state.released = true; }, async query(sql, values = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    state.queries.push(q);
    if (/^SELECT \* FROM drafts/.test(q)) return { rows: [structuredClone(draft)] };
    if (/^UPDATE scheduled_posts/.test(q)) { state.schedule = 'failed'; return { rows: [], rowCount: 1 }; }
    if (/^UPDATE drafts/.test(q)) {
      const assignments = q.slice(q.indexOf(' SET ') + 5, q.indexOf(' WHERE '));
      for (const [, field, index] of assignments.matchAll(/(\w+)\s*=\s*\$(\d+)/g)) state.saved[field] = ['slides', 'editorial_references'].includes(field) ? JSON.parse(values[Number(index) - 1]) : values[Number(index) - 1];
      state.saved.status = 'draft'; state.saved.needs_review = true;
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } };
  return { state, dependencies: { pool: { async connect() { return client; } }, storagePath: '/tmp/opencode/gapura-original-fixture', fetchImpl: async () => { throw new Error('Unexpected renderer call'); } } };
}

test('caption editing updates the exact R6 body, preserves generation metadata and never guesses hashtag boundaries', async () => {
  const fixture = editFixture();
  const caption = 'Edit #tag di tengah paragraf\n\n#GapuraMedia';
  const result = await editDraft(7, () => ({ caption, render: false }), fixture.dependencies);
  assert.equal(fixture.state.saved.caption, caption);
  assert.equal(fixture.state.saved.caption_body, caption);
  assert.equal(result.caption_body, caption);
  assert.deepEqual(result.editorial_references, { ...metadata.editorial_references, caption: [] });
  assert.deepEqual(fixture.state.saved.editorial_references, result.editorial_references);
  for (const key of ['editorial_input', 'editorial_mode', 'threads_caption', 'angle', 'scope_note']) {
    assert.deepEqual(fixture.state.saved[key], metadata[key]);
    assert.deepEqual(result[key], metadata[key]);
  }
  assert.equal(fixture.state.saved.needs_review, true);
  assert.equal(fixture.state.schedule, 'failed');
  assert.equal(fixture.state.released, true);
});

test('slide-only edits retain original metadata and ignore attempted replacement of read-only metadata', async () => {
  const fixture = editFixture();
  const result = await editDraft(7, (draft) => ({ slides: [{ ...draft.slides[0], teks: 'Judul diperbarui' }, ...draft.slides.slice(1)],
    editorial_mode: 'current', editorial_input: { mode: 'current', facts: [] }, caption_body: 'Forged',
    threads_caption: 'Forged', angle: 'Forged', scope_note: 'Forged', editorial_references: { caption: [], threads: [] }, render: false }), fixture.dependencies);
  assert.equal(fixture.state.saved.slides[0].teks, 'Judul diperbarui');
  for (const key of Object.keys(metadata)) {
    assert.deepEqual(fixture.state.saved[key], metadata[key]);
    assert.deepEqual(result[key], metadata[key]);
  }
});

test('R6 slide edits require at least three carousel slides before pinning, rendering or changing stored content', async () => {
  for (const marker of [metadata, { editorial_input: null, editorial_mode: 'explainer' }, { editorial_input: metadata.editorial_input, editorial_mode: null }]) {
    for (const count of [1, 2]) {
      const fixture = editFixture(marker);
      const before = structuredClone(fixture.state.saved);
      await assert.rejects(editDraft(7, (draft) => ({ slides: draft.slides.slice(0, count) }), fixture.dependencies), /3.*9.*slide|minimal 3/i);
      assert.deepEqual(fixture.state.saved, before);
      assert.equal(fixture.state.schedule, 'pending');
      assert.equal(fixture.state.queries.some((q) => /^(UPDATE|DELETE|INSERT)\b/i.test(q)), false);
      assert.equal(fixture.state.queries.some((q) => /FROM media_assets/i.test(q)), false);
      assert.ok(fixture.state.queries.includes('ROLLBACK'));
      assert.equal(fixture.state.released, true);
    }
  }
  const original = editFixture();
  const result = await editDraft(7, (draft) => ({ slides: draft.slides, content_format: 'single', render: false }), original.dependencies);
  assert.equal(result.content_format, 'carousel');
  assert.equal(original.state.saved.content_format, 'carousel');
});

test('historical explicit single drafts remain editable without original metadata or carousel requirements', async () => {
  const nullable = Object.fromEntries(Object.keys(metadata).map((key) => [key, null]));
  const fixture = editFixture({ ...nullable, slides: [{ no: 1, layout: 'cover-focus', teks: 'Judul historical', data: {} }], content_format: 'single' });
  const result = await editDraft(7, (draft) => ({ slides: [{ ...draft.slides[0], teks: 'Edit historical' }], render: false }), fixture.dependencies);
  assert.equal(result.slides.length, 1);
  assert.equal(result.slides[0].teks, 'Edit historical');
  assert.equal(result.content_format, 'single');
  assert.equal(fixture.state.saved.content_format, 'single');
  for (const field of Object.keys(metadata)) assert.equal(result[field], null);
});

test('current fact IDs survive slide validation, illustration pinning and the renderer payload', async () => {
  const fixture = editFixture({ editorial_mode: 'current', editorial_input: { version: 1, mode: 'current', facts: [{ id: 'f1', text: 'Fakta redaksi' }] } });
  let rendered;
  const result = await editDraft(7, (draft) => ({ slides: draft.slides.map((slide) => ({ ...slide, claim_type: 'fact', fact_ids: ['f1'] })) }), {
    ...fixture.dependencies, renderUrl: 'http://fixture.invalid', fetchImpl: async (url, init) => {
      rendered = JSON.parse(init.body).slides;
      return Response.json({ rendered_slides: rendered.map((slide) => ({ slide_no: slide.no })) });
    },
  });
  for (const collection of [result.slides, rendered, fixture.state.saved.slides]) for (const slide of collection) assert.deepEqual(slide.fact_ids, ['f1']);
  assert.deepEqual(result.editorial_input.facts[0].id, 'f1');
  assert.deepEqual(result.editorial_references, metadata.editorial_references);
});

test('original edits enforce the final caption limit once while legacy edits retain the caption-plus-hashtag limit', async () => {
  const caption = `${'x'.repeat(2187)} #GapuraMedia`;
  assert.equal(caption.length, 2200);
  const original = editFixture({ caption, caption_body: 'x'.repeat(2187) });
  const result = await editDraft(7, () => ({ render: false }), original.dependencies);
  assert.equal(result.caption, caption);
  const tooLong = editFixture();
  await assert.rejects(editDraft(7, () => ({ caption: `${caption}x`, render: false }), tooLong.dependencies), /2200/);
  const legacy = editFixture(Object.fromEntries(Object.keys(metadata).map((key) => [key, null])));
  await assert.rejects(editDraft(7, () => ({ caption, render: false }), legacy.dependencies), /2200/);
});

test('historical caption edits leave R6 columns nullable and keep their legacy revision content', async () => {
  const nullable = Object.fromEntries(Object.keys(metadata).map((key) => [key, null]));
  const fixture = editFixture(nullable);
  const result = await editDraft(7, () => ({ caption: 'Historical revised caption', render: false }), fixture.dependencies);
  for (const key of Object.keys(nullable)) {
    assert.equal(fixture.state.saved[key], null);
    assert.equal(result[key], null);
  }
  assert.equal(draftContentHash(result), draftContentHash({ slides: result.slides, caption: result.caption, hashtags: result.hashtags, content_format: result.content_format }));
});

async function seed(t, extra = metadata) {
  const { rows: [topic] } = await pool.query("INSERT INTO topics(title,url,primary_source,status) VALUES('Original fixture','https://www.bps.go.id/original-fixture','BPS','produced') RETURNING id");
  const slides = [{ no: 1, layout: 'cover-focus', teks: 'Penjelasan warga', data: { title: 'Penjelasan warga' } },
    { no: 2, layout: 'big-statement', teks: 'Mekanisme keputusan dapat dilihat dari proses dan tanggung jawab pelaksana.', data: {} },
    { no: 3, layout: 'big-statement', teks: 'Pertanyaan warga membantu mengenali batas informasi yang tersedia.', data: {} }];
  const { rows: [draft] } = await pool.query(`INSERT INTO drafts(topic_id,slides,caption,hashtags,copy_model,status,needs_review,content_format,editorial_input,editorial_mode,caption_body,threads_caption,angle,scope_note,editorial_references)
    VALUES($1,$2,'Isi asli #dalam-teks',ARRAY['#GapuraMedia'],'fixture','draft',true,'carousel',$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [topic.id, JSON.stringify(slides), extra.editorial_input, extra.editorial_mode, extra.caption_body, extra.threads_caption, extra.angle, extra.scope_note, extra.editorial_references]);
  t.after(async () => {
    await pool.query('DELETE FROM audit_log WHERE entity=\'draft\' AND entity_id=$1', [draft.id]);
    await pool.query('DELETE FROM publication_targets WHERE draft_id=$1', [draft.id]);
    await pool.query('DELETE FROM scheduled_posts WHERE draft_id=$1', [draft.id]);
    await pool.query('DELETE FROM drafts WHERE id=$1', [draft.id]);
    await pool.query('DELETE FROM topics WHERE id=$1', [topic.id]);
  });
  return draft;
}

const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

test('original mode, curated input and every metadata mutation reject stale browser approval', { skip: !enabled }, async (t) => {
  for (const [field, value] of Object.entries({
    editorial_mode: 'current', editorial_input: { version: 1, mode: 'explainer', facts: [], context: 'Changed input' },
    caption_body: 'Changed body', threads_caption: 'Changed Threads', angle: 'Changed angle', scope_note: 'Changed scope',
    editorial_references: { caption: [], threads: ['f2'] },
  })) await t.test(field, async (t) => {
    const draft = await seed(t);
    const detail = await (await fetch(`${base}/api/drafts/${draft.id}`)).json();
    await pool.query(`UPDATE drafts SET ${field}=$1 WHERE id=$2`, [typeof value === 'object' ? JSON.stringify(value) : value, draft.id]);
    const { rows: [mutated] } = await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id]);
    assert.equal(mutated.updated_at.toISOString(), draft.updated_at.toISOString(), 'mutation must be caught by content, without relying on a timestamp change');
    assert.notEqual(draftContentHash(mutated), detail.revision);
    const rejected = await post(`/api/drafts/${draft.id}/approve`, { mode: 'auto', reviewed: true, expected_revision: detail.revision });
    assert.equal(rejected.status, 409, await rejected.clone().text());
    assert.match((await rejected.json()).error, /Draf telah berubah|Muat ulang/i);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM scheduled_posts WHERE draft_id=$1', [draft.id])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action='approved_auto'", [draft.id])).rows[0].n, 0);
  });
});

test('original caption and slide edits preserve mode and input, synchronize body and invalidate queued approval', { skip: !enabled }, async (t) => {
  const draft = await seed(t);
  await pool.query("UPDATE drafts SET status='scheduled',needs_review=false WHERE id=$1", [draft.id]);
  await pool.query("INSERT INTO scheduled_posts(draft_id,mode,scheduled_at,status) VALUES($1,'auto',NOW()+interval '1 day','pending')", [draft.id]);
  const caption = 'Warga membahas #topik di paragraf pertama.\n\n#GapuraMedia';
  const edited = await post(`/api/drafts/${draft.id}/update-full`, { caption, hashtags: ['#GapuraMedia'], editorial_mode: 'current', editorial_input: { mode: 'current' } });
  assert.equal(edited.status, 200, await edited.clone().text());
  const slide = await post(`/api/drafts/${draft.id}/edit-slide`, { slide_no: 1, new_text: 'Judul warga diperbarui' });
  assert.equal(slide.status, 200, await slide.clone().text());
  const { rows: [saved] } = await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id]);
  assert.equal(saved.caption, caption);
  assert.equal(saved.caption_body, caption);
  assert.deepEqual(saved.editorial_references, { ...draft.editorial_references, caption: [] });
  assert.equal(saved.slides[0].teks, 'Judul warga diperbarui');
  for (const key of ['editorial_input', 'editorial_mode', 'threads_caption', 'angle', 'scope_note']) assert.deepEqual(saved[key], draft[key]);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.needs_review, true);
  assert.equal((await pool.query('SELECT status FROM scheduled_posts WHERE draft_id=$1', [draft.id])).rows[0].status, 'failed');
});

test('R6 delete-slide and full-edit APIs reject a downgrade below three slides without changing snapshots or review state', { skip: !enabled }, async (t) => {
  const draft = await seed(t);
  for (const [route, body] of [
    ['delete-slide', { slide_no: 3 }],
    ['update-full', { slides: draft.slides.slice(0, 2) }],
    ['update-full', { slides: draft.slides.slice(0, 1) }],
  ]) {
    const response = await post(`/api/drafts/${draft.id}/${route}`, body);
    assert.equal(response.status, 400, await response.clone().text());
    assert.match((await response.json()).error, /3-9 slide/);
    const { rows: [saved] } = await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id]);
    assert.deepEqual(saved, draft);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM draft_slides WHERE draft_id=$1', [draft.id])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action='edited_review_required'", [draft.id])).rows[0].n, 0);
  }
});

const metaConfig = () => publicationConfigFromEnv({
  META_PLATFORMS: 'instagram', META_PUBLISH_MODE: 'live', META_PAGE_ACCESS_TOKEN: 'fixture-token',
  META_INSTAGRAM_ACCOUNT_ID: 'original-fixture-account', GAPURA_ADMIN_TOKEN: 'x'.repeat(64),
  GAPURA_META_CONNECTION: '/tmp/opencode/gapura-r6-missing-meta-connection.json', APP_BASE_URL: 'https://gapura.example',
});

async function scheduleReviewed(draft) {
  await pool.query("INSERT INTO topic_scores(topic_id,score_relevance,score_credibility,score_momentum,score_engagement,score_compliance,score_total,verdict,model) VALUES($1,30,25,20,15,10,100,'passed','fixture')", [draft.topic_id]);
  await pool.query("UPDATE drafts SET status='scheduled',needs_review=false WHERE id=$1", [draft.id]);
  await pool.query("INSERT INTO scheduled_posts(draft_id,mode,scheduled_at,status) VALUES($1,'auto',NOW()-interval '1 minute','pending')", [draft.id]);
  const { rows: [current] } = await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id]);
  await pool.query("INSERT INTO audit_log(entity,entity_id,action,actor,payload) VALUES('draft',$1,'approved_auto','web_admin',$2)", [draft.id, JSON.stringify({ content_hash: draftContentHash(current) })]);
}

test('real publisher claim and locked publish queries round-trip the reviewed original metadata', { skip: !enabled }, async (t) => {
  for (const kind of ['meta', 'legacy']) await t.test(kind, async (t) => {
    const draft = await seed(t);
    await scheduleReviewed(draft);
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push(String(url));
      return Response.json(String(url).includes('/media_publish') ? { id: `original-${kind}-post` }
        : init.method === 'GET' ? String(url).includes('permalink') ? { permalink: 'https://www.instagram.com/p/original-fixture/' } : { status_code: 'FINISHED' }
          : { id: `original-${kind}-container` });
    };
    const result = kind === 'meta'
      ? await createMetaPublisherWorker({ pool, config: metaConfig(), fetchImpl, logger: { warn() {} } }).runOnce()
      : await createPublisher({ pool, config: { baseUrl: 'https://gapura.example', igAccountId: 'original-fixture-account', igAccessToken: 'fixture-token', signingSecret: 'fixture-secret' }, fetchImpl, logger: { warn() {} } }).runPublisher();
    assert.equal(result.published, 1);
    assert.equal(calls.filter((url) => url.includes('/media_publish')).length, 1);
    const { rows: [published] } = await pool.query('SELECT * FROM drafts WHERE id=$1', [draft.id]);
    assert.equal(published.status, 'published');
    for (const field of Object.keys(metadata)) assert.deepEqual(published[field], draft[field]);
  });
});

test('real publisher SQL blocks changed original input and mode before any outbound request', { skip: !enabled }, async (t) => {
  for (const kind of ['meta', 'legacy']) for (const [field, value] of Object.entries({
    editorial_mode: 'current', editorial_input: { version: 1, mode: 'explainer', facts: [], context: 'Changed after approval' },
  })) await t.test(`${kind} ${field}`, async (t) => {
    const draft = await seed(t);
    await scheduleReviewed(draft);
    await pool.query(`UPDATE drafts SET ${field}=$1 WHERE id=$2`, [typeof value === 'object' ? JSON.stringify(value) : value, draft.id]);
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('Changed revisions must not reach Meta'); };
    const result = kind === 'meta'
      ? await createMetaPublisherWorker({ pool, config: metaConfig(), fetchImpl, logger: { warn() {} } }).runOnce()
      : await createPublisher({ pool, config: { baseUrl: 'https://gapura.example', igAccountId: 'original-fixture-account', igAccessToken: 'fixture-token', signingSecret: 'fixture-secret' }, fetchImpl, logger: { warn() {} } }).runPublisher();
    assert.equal(result.blocked, 1);
    assert.equal(result.published, 0);
    assert.equal(calls, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity='draft' AND entity_id=$1 AND action IN ('published_auto','published_platform')", [draft.id])).rows[0].n, 0);
  });
});

test('real Threads target refuses missing R6 text instead of using a short Instagram caption', { skip: !enabled }, async (t) => {
  const draft = await seed(t, { ...metadata, threads_caption: null });
  await scheduleReviewed(draft);
  // The worker synchronizes every due schedule. Give this platform-specific
  // test its own tables so schedules left by other test files cannot publish.
  const client = await pool.connect();
  const schema = `threads_fixture_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => {
    try {
      await client.query('RESET search_path');
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally { client.release(); }
  });
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  for (const table of ['topics', 'topic_scores', 'drafts', 'scheduled_posts', 'publication_targets', 'audit_log']) {
    await client.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  await client.query('INSERT INTO topics SELECT * FROM public.topics WHERE id=$1', [draft.topic_id]);
  await client.query('INSERT INTO topic_scores SELECT * FROM public.topic_scores WHERE topic_id=$1', [draft.topic_id]);
  await client.query('INSERT INTO drafts SELECT * FROM public.drafts WHERE id=$1', [draft.id]);
  await client.query('INSERT INTO scheduled_posts SELECT * FROM public.scheduled_posts WHERE draft_id=$1', [draft.id]);
  await client.query("INSERT INTO audit_log SELECT * FROM public.audit_log WHERE entity='draft' AND entity_id=$1", [draft.id]);
  const scopedPool = { async connect() { return { query: (...args) => client.query(...args), release() {} }; } };
  let calls = 0;
  const config = publicationConfigFromEnv({ META_PLATFORMS: 'threads', META_PUBLISH_MODE: 'live', META_THREADS_USER_ID: 'original-threads-fixture',
    META_THREADS_ACCESS_TOKEN: 'fixture-token', GAPURA_ADMIN_TOKEN: 'x'.repeat(64), APP_BASE_URL: 'https://gapura.example',
    GAPURA_META_CONNECTION: '/tmp/opencode/gapura-r6-missing-meta-connection.json' });
  const result = await createMetaPublisherWorker({ pool: scopedPool, config, fetchImpl: async () => { calls++; throw new Error('No remote calls'); }, logger: { warn() {} } }).runOnce();
  assert.equal(result.blocked, 1);
  assert.equal(result.published, 0);
  assert.equal(result.unknown, 0);
  assert.equal(calls, 0);
  const { rows: [target] } = await client.query("SELECT status,container_id,publish_attempted_at,error_message FROM publication_targets WHERE draft_id=$1 AND platform='threads'", [draft.id]);
  assert.equal(target.status, 'blocked');
  assert.equal(target.container_id, null);
  assert.equal(target.publish_attempted_at, null);
  assert.match(target.error_message, /Caption Threads.*500/);
});
