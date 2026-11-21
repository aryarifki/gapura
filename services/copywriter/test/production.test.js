import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from '../../render/node_modules/sharp/lib/index.js';
import { saveIllustrationRaster } from '../../designer/illustrations.js';
import { saveManualMediaRaster } from '../../designer/manual-media.js';
import { buildEditorialBrief, validateOriginalContent } from '../../common/original-editorial.js';
import { originalFixture } from '../../common/test/fixtures/original-editorial.js';

mock.module('dotenv', { defaultExport: { config() {} } });
mock.module('pg', { defaultExport: { Pool: class { query() { throw new Error('No live database in unit tests'); } } } });
const callAgentLLM = mock.fn(async () => { throw new Error('No live LLM in unit tests'); });
let config = { analis: { min_score_threshold: 76 } };
mock.module('../../common/llm.js', { namedExports: {
  loadAgentsConfig: () => config, loadAgentSkills: () => '',
  callAgentLLM,
} });
const { produceSingleTopicDraft: produceNewsDraft, regenerateDraft: regenerateNewsDraft, runCopywriter, pool } = await import('../copywriter.js');
const topic = { id: 42, title: 'BPS merilis inflasi Oktober', summary: 'Inflasi Oktober mencapai 2,1%.', primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/1', status: 'scored' };
const testExplainerInput = { version: 1, mode: 'explainer', facts: [] };
const produceSingleTopicDraft = (source, db, options = {}) => produceNewsDraft(source, db,
  options.editorialInput !== undefined ? options : { editorialInput: testExplainerInput, ...options });
const regenerateDraft = (id, db, options = {}) => regenerateNewsDraft(id, db,
  options.editorialInput !== undefined ? options : { editorialInput: testExplainerInput, ...options });

test.beforeEach((t) => {
  config = { analis: { min_score_threshold: 76 } };
  callAgentLLM.mock.resetCalls();
  callAgentLLM.mock.mockImplementation(async (agent, prompt) => {
    if (agent === 'copywriter') return JSON.stringify(originalFixture(JSON.parse(prompt.split('ORIGINAL_EDITORIAL_JSON: ')[1])));
    const script = JSON.parse(prompt.split('NASKAH_GAPURA_JSON: ')[1].split('\nKembalikan')[0]);
    return JSON.stringify({ slides: script.slides.map(({ no, layout }) => ({ no, layout })) });
  });
  t.mock.method(console, 'warn', () => {});
});

function completeDraft(overrides = {}, options = {}) {
  const brief = buildEditorialBrief(topic, options);
  const content = validateOriginalContent(originalFixture(brief), brief);
  return { ...content, id: 12, topic_id: topic.id, status: 'draft', content_format: content.format, rendered_count: content.slides.length, ...overrides };
}

function database(overrides = {}) {
  const sql = [];
  let releaseCount = 0;
  let inserted = 0;
  const client = {
    release() { releaseCount++; },
    async query(text, values = []) {
      sql.push({ text, values });
      if (/\bverification_reports\b/i.test(text)) throw new Error('Archived verification reports must not be accessed');
      if (/FROM topics\b/i.test(text)) return { rows: overrides.missingTopic ? [] : [{ ...topic, ...overrides.topic }] };
      if (/FROM topic_scores\b/i.test(text)) return { rows: overrides.score === null ? [] : [{ score_total: 88, verdict: 'passed', ...overrides.score }] };
      if (/FROM drafts\b/i.test(text)) return { rows: overrides.existing || [] };
      if (/FROM publication_targets\b/i.test(text)) {
        assert.match(text, /WHERE draft_id = \$1\s+AND \(status IN \('publishing',\s*'unknown',\s*'published'\) OR publish_attempted_at IS NOT NULL OR remote_id IS NOT NULL\) LIMIT 1/i);
        return { rows: (overrides.publicationTargets || []).filter((target) => String(target.draft_id) === String(values[0])
          && (['publishing', 'unknown', 'published'].includes(target.status) || target.publish_attempted_at != null || target.remote_id != null)) };
      }
      if (/FROM audit_log\b/i.test(text)) return { rows: overrides.audit || [] };
      if (/FROM media_assets\b/i.test(text)) return { rows: (overrides.assets || []).filter((asset) => /WHERE id=\$1/.test(text)
        ? asset.id === values[0] : String(asset.topic_id) === String(values[0]) && asset.selected && asset.status === 'ready') };
      if (/FROM manual_media_assets\b/i.test(text)) return { rows: (overrides.manualMediaAssets || []).filter((asset) => asset.id === values[0]) };
      if (/INSERT INTO drafts\b/i.test(text)) { inserted++; return { rows: [{ id: 80 + inserted }] }; }
      return { rows: [], rowCount: 1 };
    },
  };
  return { client, sql, get releaseCount() { return releaseCount; }, get inserted() { return inserted; } };
}
function mockRender(t, response) {
  return t.mock.method(globalThis, 'fetch', async (_url, opts) => {
    const request = JSON.parse(opts.body);
    if (response) return response(request);
    return { ok: true, json: async () => ({ rendered_slides: request.slides.map((slide, index) => ({ slide_no: index + 1, layout: slide.layout, file_path: `/test/slide-${index + 1}.png` })), total_time_ms: 20 }) };
  });
}

test('rejects missing, unscored or failed-scoring sources before LLM and render costs', async (t) => {
  const render = mockRender(t);
  for (const [override, reason] of [
    [{ missingTopic: true }, /topic_not_found|sumber tidak ditemukan/i],
    [{ topic: { status: 'new' } }, /topic_not_scored/],
    [{ score: null }, /score_not_passed/],
    [{ score: { score_total: 70 } }, /score_below_threshold/],
    [{ score: { score_total: 101 } }, /score_below_threshold/],
    [{ score: { score_total: 88.5 } }, /score_below_threshold/],
    [{ score: { verdict: 'rejected' } }, /score_not_passed/],
  ]) {
    const db = database(override);
    await assert.rejects(produceSingleTopicDraft(topic, db.client), reason);
    assert.equal(db.inserted, 0);
    assert.equal(db.sql.at(-1).text, 'ROLLBACK');
    assert.ok(!db.sql.some(({ text }) => /\bverification_reports\b/i.test(text)));
  }
  assert.equal(render.mock.callCount(), 0);
  assert.equal(callAgentLLM.mock.callCount(), 0);
});

test('source URL validation rejects missing, credentialed and internal URLs before LLM or rendering', async (t) => {
  const render = mockRender(t);
  for (const url of ['', 'invalid', 'http://www.bps.go.id/rilis/1', 'https://user:secret@www.bps.go.id/rilis/1', 'https://localhost/private', 'https://127.0.0.1/private', 'https://[::1]/private']) {
    const db = database({ topic: { url } });
    await assert.rejects(produceSingleTopicDraft(topic, db.client), /public_source_url_required/);
    assert.equal(db.inserted, 0);
    assert.equal(db.sql.at(-1).text, 'ROLLBACK');
  }
  assert.equal(render.mock.callCount(), 0);
  assert.equal(callAgentLLM.mock.callCount(), 0);
});

test('an analyzed source can produce without a verification report and legacy flags cannot block production', async (t) => {
  const render = mockRender(t);
  for (const verification_status of [undefined, null, 'unverified', 'verified', 'hoax_detected']) {
    const db = database({ topic: { verification_status } });
    const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true });
    assert.equal(result.is_existing, false);
    assert.equal(result.draft_id, 81);
    const insert = db.sql.find(({ text }) => /INSERT INTO drafts\b/.test(text));
    assert.equal(insert.values[6], true, 'review approval is still required for Studio output');
    assert.ok(!db.sql.some(({ text }) => /\bverification_reports\b/i.test(text)));
    assert.equal(db.sql.at(-1).text, 'COMMIT');
  }
  assert.equal(render.mock.callCount(), 5);
});

test('batch selection uses the latest passing analyst score without archived verification filters', async (t) => {
  const select = t.mock.method(pool, 'query', async () => ({ rows: [] }));
  const result = await runCopywriter(2);
  assert.equal(result.produced, 0);
  assert.equal(select.mock.callCount(), 1);
  const [text, values] = select.mock.calls[0].arguments;
  assert.match(text, /JOIN LATERAL.*SELECT score_total, verdict FROM topic_scores/s);
  assert.match(text, /ORDER BY created_at DESC, id DESC LIMIT 1/);
  assert.match(text, /t\.status = 'scored' AND ts\.verdict = 'passed' AND ts\.score_total >= \$2/);
  assert.doesNotMatch(text, /verification_reports|verification_status|confidence|hoax_detected/i);
  assert.deepEqual(values, [2, 76]);
  assert.equal(callAgentLLM.mock.callCount(), 0);
});

test('acquires one Pool connection and commits a complete render under a per-topic transaction lock', async (t) => {
  mockRender(t);
  const db = database();
  let connects = 0;
  const pool = { connect: async () => { connects++; return db.client; }, query() { throw new Error('Transaction must not use Pool.query'); } };
  const result = await produceSingleTopicDraft(topic, pool, { forceReview: true });
  assert.equal(result.is_existing, false);
  assert.equal(connects, 1);
  assert.equal(db.releaseCount, 1);
  assert.equal(db.sql[0].text, 'BEGIN');
  const lock = db.sql.findIndex(({ text }) => /pg_advisory_xact_lock/.test(text));
  const source = db.sql.findIndex(({ text }) => /FROM topics\b/.test(text));
  const insert = db.sql.findIndex(({ text }) => /INSERT INTO drafts\b/.test(text));
  const slides = db.sql.findIndex(({ text }) => /INSERT INTO draft_slides\b/.test(text));
  const produced = db.sql.findIndex(({ text }) => /UPDATE topics SET status = 'produced'/.test(text));
  const audit = db.sql.findIndex(({ text }) => /INSERT INTO audit_log\b/.test(text));
  assert.ok(lock > 0 && source > lock && insert > source && slides > insert && produced > slides && audit > produced);
  assert.deepEqual(db.sql[lock].values, ['gapura:topic:42']);
  assert.match(db.sql[source].text, /FOR UPDATE/);
  assert.equal(db.sql[insert].values[6], true);
  assert.ok(!db.sql.some(({ text }) => /\bverification_reports\b/i.test(text)));
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('render failure rolls back draft creation and never marks the topic produced', async (t) => {
  mockRender(t, () => ({ ok: false, status: 503, text: async () => 'renderer unavailable' }));
  const db = database();
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /Render Service/);
  assert.ok(db.sql.some(({ text }) => text === 'ROLLBACK'));
  assert.ok(!db.sql.some(({ text }) => text === 'COMMIT' || /SET status = 'produced'/.test(text)));
  assert.equal(db.releaseCount, 0);
});

test('partial render results roll back rather than creating a successful incomplete draft', async (t) => {
  mockRender(t, () => ({ ok: true, json: async () => ({ rendered_slides: [], total_time_ms: 20 }) }));
  const db = database();
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /render.*(incomplete|lengkap)|hasil render/i);
  assert.equal(db.sql.at(-1).text, 'ROLLBACK');
});

test('an incomplete existing draft is not returned as an idempotent success', async (t) => {
  const render = mockRender(t);
  const db = database({ existing: [{ id: 12, status: 'draft', slides: [{ no: 1, teks: topic.title }], rendered_count: 0, content_format: 'single' }] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.is_existing, false);
  assert.equal(render.mock.callCount(), 1);
  assert.ok(db.sql.some(({ text }) => /UPDATE drafts SET status = 'failed'/.test(text)));
});

test('complete existing output is reused after current source and analyst gates without reading archived reports', async (t) => {
  const render = mockRender(t);
  const db = database({ topic: { status: 'produced' }, existing: [completeDraft()] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.draft_id, 12);
  assert.equal(result.is_existing, true);
  assert.equal(render.mock.callCount(), 0);
  assert.ok(db.sql.some(({ text }) => /FROM topics\b/.test(text)));
  assert.ok(db.sql.some(({ text }) => /FROM topic_scores\b/.test(text)));
  assert.ok(!db.sql.some(({ text }) => /\bverification_reports\b/i.test(text)));
  assert.equal(callAgentLLM.mock.callCount(), 0);
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('complete output cannot bypass newly failed analyst or source gates even with archived verified status', async (t) => {
  const render = mockRender(t);
  const existing = [completeDraft()];
  for (const [override, reason] of [
    [{ score: null }, /score_not_passed/],
    [{ score: { score_total: 70 } }, /score_below_threshold/],
    [{ score: { verdict: 'rejected' } }, /score_not_passed/],
    [{ topic: { primary_source: ' ' } }, /source_evidence_required/],
    [{ topic: { url: 'https://localhost/private' } }, /public_source_url_required/],
  ]) {
    const db = database({ ...override, topic: { status: 'produced', verification_status: 'verified', ...override.topic }, existing });
    await assert.rejects(produceSingleTopicDraft(topic, db.client), reason);
    assert.equal(db.inserted, 0);
    assert.equal(db.sql.at(-1).text, 'ROLLBACK');
  }
  assert.equal(render.mock.callCount(), 0);
  assert.equal(callAgentLLM.mock.callCount(), 0);
});

test('new Studio briefs create their own output rather than reusing another editorial job draft', async (t) => {
  const render = mockRender(t);
  const db = database({ topic: { status: 'produced' }, existing: [completeDraft()] });
  const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true, editorialBrief: { job_id: 9, prompt: 'Ringkas', plan: { format: 'single', sections: ['Data', 'Sumber'] } } });
  assert.equal(result.is_existing, false);
  assert.notEqual(result.draft_id, 12);
  assert.equal(render.mock.callCount(), 1);
});

test('the same Studio brief retries its complete audited draft without rendering again', async (t) => {
  const render = mockRender(t);
  const editorialBrief = { job_id: 9, prompt: 'Ringkas', plan: { format: 'single', sections: ['Data', 'Sumber'] } };
  const db = database({ topic: { status: 'produced' }, existing: [completeDraft()], audit: [{ entity_id: 12, payload: { editorial_brief: editorialBrief } }] });
  const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true, editorialBrief });
  assert.equal(result.is_existing, true);
  assert.equal(result.draft_id, 12);
  assert.equal(render.mock.callCount(), 0);
});

test('regeneration updates format and rendered assets atomically and invalidates stale approvals', async (t) => {
  mockRender(t);
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }] });
  const result = await regenerateDraft(12, db.client);
  assert.equal(result.draft_id, 12);
  assert.equal(db.inserted, 0);
  const update = db.sql.find(({ text }) => /UPDATE drafts SET slides/.test(text));
  assert.match(update.text, /content_format = \$3/);
  assert.match(update.text, /needs_review = TRUE/);
  assert.ok(db.sql.some(({ text }) => /UPDATE scheduled_posts SET status = 'failed'/.test(text)));
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('regeneration requires publication reconciliation before LLM, render or asset changes', async (t) => {
  const render = mockRender(t);
  for (const status of ['draft', 'failed', 'rejected']) {
    for (const target of [
      { status: 'publishing' },
      { status: 'unknown' },
      { status: 'published' },
      { status: 'failed', publish_attempted_at: '2026-11-16T00:00:00Z' },
      { status: 'failed', remote_id: 'meta-post-12' },
    ]) await t.test(`${status} draft with ${JSON.stringify(target)}`, async () => {
      const llmCalls = callAgentLLM.mock.callCount();
      const db = database({ existing: [{ id: 12, topic_id: 42, status }], publicationTargets: [{ draft_id: 12, ...target }] });
      await assert.rejects(regenerateDraft(12, db.client), { message: 'draft_publication_requires_reconciliation' });
      assert.equal(callAgentLLM.mock.callCount(), llmCalls);
      assert.equal(render.mock.callCount(), 0);
      assert.ok(!db.sql.some(({ text }) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(text)));
      assert.equal(db.sql.at(-1).text, 'ROLLBACK');
    });
  }
});

test('regeneration allows targets without publication attempts and ignores other drafts targets', async (t) => {
  const render = mockRender(t);
  const db = database({
    existing: [{ id: 12, topic_id: 42, status: 'rejected' }],
    publicationTargets: [
      ...['pending', 'shadow', 'blocked', 'failed'].map((status) => ({ draft_id: 12, status, publish_attempted_at: null, remote_id: null })),
      { draft_id: 99, status: 'unknown', publish_attempted_at: '2026-11-16T00:00:00Z', remote_id: 'meta-post-99' },
    ],
  });
  const result = await regenerateDraft(12, db.client);
  assert.equal(result.draft_id, 12);
  assert.equal(render.mock.callCount(), 1);
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('regeneration failure rolls back and marks the draft failed so stale render files cannot be published', async (t) => {
  mockRender(t, () => ({ ok: false, status: 503, text: async () => 'renderer unavailable' }));
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }] });
  await assert.rejects(regenerateDraft(12, db.client), /Render Service/);
  const rollback = db.sql.findIndex(({ text }) => /^ROLLBACK(?: TO SAVEPOINT)/.test(text));
  assert.ok(rollback >= 0);
  assert.ok(db.sql.slice(rollback + 1).some(({ text }) => /UPDATE drafts SET status = 'failed'/.test(text)));
  assert.ok(!db.sql.some(({ text }) => text === 'ROLLBACK'), 'do not release the topic lock before marking failed');
});

test('render duplicates and invalid slide identifiers are rejected', async (t) => {
  mockRender(t, () => ({ ok: true, json: async () => ({ rendered_slides: [{ slide_no: 9, file_path: '/test/unrelated.png' }] }) }));
  const db = database();
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /Hasil render/);
  assert.equal(db.sql.at(-1).text, 'ROLLBACK');
});

test('a connected pg.Client is used directly even though it has a connect method', async (t) => {
  mockRender(t);
  const db = database();
  const connectedClient = { query: db.client.query, connection: {}, connect() { throw new Error('Client is already connected'); } };
  const result = await produceSingleTopicDraft(topic, connectedClient);
  assert.equal(result.is_existing, false);
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('unknown source evidence is rejected before designer and render costs', async (t) => {
  const render = mockRender(t);
  for (const field of ['title', 'primary_source']) {
    const db = database({ topic: { [field]: ' ' } });
    await assert.rejects(produceSingleTopicDraft(topic, db.client), /source_evidence_required/);
    assert.equal(db.inserted, 0);
    assert.equal(db.sql.at(-1).text, 'ROLLBACK');
  }
  assert.equal(callAgentLLM.mock.callCount(), 0);
  assert.equal(render.mock.callCount(), 0);
});

test('audit JSONB key ordering does not break retry idempotency for a Studio brief', async (t) => {
  const render = mockRender(t);
  const editorialBrief = { job_id: 9, prompt: 'Ringkas', plan: { format: 'single', sections: ['Data', 'Sumber'] } };
  const storedBrief = { plan: { sections: ['Data', 'Sumber'], format: 'single' }, prompt: 'Ringkas', job_id: 9 };
  const db = database({ topic: { status: 'produced' }, existing: [completeDraft()], audit: [{ entity_id: 12, payload: { editorial_brief: storedBrief } }] });
  const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true, editorialBrief });
  assert.equal(result.is_existing, true);
  assert.equal(render.mock.callCount(), 0);
});

test('an archived verification change during rendering cannot control the production transaction', async (t) => {
  const db = database();
  const query = db.client.query;
  let archivedStatus = 'verified';
  db.client.query = async (text, values) => {
    const result = await query(text, values);
    return /FROM topics\b/.test(text) ? { rows: result.rows.map((row) => ({ ...row, verification_status: archivedStatus })) } : result;
  };
  mockRender(t, (request) => {
    archivedStatus = 'hoax_detected';
    return { ok: true, json: async () => ({ rendered_slides: request.slides.map((slide, index) => ({ slide_no: index + 1, layout: slide.layout, file_path: `/test/${index + 1}.png` })) }) };
  });
  const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true });
  assert.equal(result.draft_id, 81);
  assert.equal(archivedStatus, 'hoax_detected');
  assert.ok(!db.sql.some(({ text }) => /\bverification_reports\b/i.test(text)));
  assert.ok(db.sql.some(({ text }) => /UPDATE topics SET status = 'produced'/.test(text)));
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('an existing single draft containing two rendered slides is not considered complete', async (t) => {
  mockRender(t);
  const db = database({ existing: [{ id: 12, status: 'draft', slides: [{ no: 1, teks: topic.title }, { no: 2, teks: topic.summary }], rendered_count: 2, content_format: 'single' }] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.is_existing, false);
});

test('regeneration ignores archived verification confidence and keeps review required without report reads', async (t) => {
  const render = mockRender(t);
  const db = database({ topic: { status: 'produced', verification_status: 'hoax_detected', confidence: null }, existing: [{ id: 12, topic_id: 42, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }] });
  const result = await regenerateDraft(12, db.client);
  assert.equal(result.draft_id, 12);
  assert.equal(db.inserted, 0);
  assert.equal(render.mock.callCount(), 1);
  assert.match(db.sql.find(({ text }) => /UPDATE drafts SET slides/.test(text)).text, /needs_review = TRUE/);
  assert.ok(!db.sql.some(({ text }) => /\bverification_reports\b/i.test(text)));
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('concurrent connections wait for the per-topic transaction and reuse its committed complete draft', async (t) => {
  let resolveLock;
  let lockHeld = false;
  let completedDraft = null;
  let insertionCount = 0;
  let renders = 0;
  const waiters = [];
  const clients = [];
  const dbPool = {
    async connect() {
      const db = database();
      const query = db.client.query;
      let ownsLock = false;
      db.client.query = async (sql, values) => {
        if (/pg_advisory_xact_lock/.test(sql)) {
          if (lockHeld) await new Promise((resolve) => waiters.push(resolve));
          lockHeld = true;
          ownsLock = true;
        }
        if (/FROM drafts\b/.test(sql)) return { rows: completedDraft ? [completedDraft] : [] };
        if (/INSERT INTO drafts/.test(sql)) { insertionCount++; return { rows: [{ id: 81 }] }; }
        if (sql === 'COMMIT' && ownsLock) {
          completedDraft = completeDraft({ id: 81 });
          lockHeld = false;
          ownsLock = false;
          waiters.shift()?.();
        }
        return query(sql, values);
      };
      clients.push(db);
      return db.client;
    },
  };
  const renderGate = new Promise((resolve) => { resolveLock = resolve; });
  mockRender(t, async (request) => {
    renders++;
    await renderGate;
    return { ok: true, json: async () => ({ rendered_slides: request.slides.map((slide, index) => ({ slide_no: index + 1, file_path: `/test/${index + 1}.png` })) }) };
  });
  const first = produceSingleTopicDraft(topic, dbPool);
  for (let n = 0; n < 100 && !renders; n++) await Promise.resolve();
  const second = produceSingleTopicDraft(topic, dbPool);
  for (let n = 0; n < 40; n++) await Promise.resolve();
  resolveLock();
  const results = await Promise.all([first, second]);
  assert.equal(insertionCount, 1);
  assert.equal(renders, 1);
  assert.equal(results.filter((result) => result.is_existing).length, 1);
  assert.ok(clients.every((db) => db.releaseCount === 1));
});

test('regeneration preserves a Studio draft editorial brief when the web caller supplies no new brief', async (t) => {
  mockRender(t);
  const editorialBrief = { job_id: 9, prompt: 'Fokus sumber', plan: { format: 'single', sections: ['Data BPS', 'Sumber'] } };
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }], audit: [{ entity_id: 12, payload: { editorial_brief: editorialBrief } }] });
  await regenerateDraft(12, db.client);
  const audit = db.sql.find(({ text, values }) => /INSERT INTO audit_log/.test(text) && values[1] === 'regenerated');
  assert.deepEqual(JSON.parse(audit.values[2]).editorial_brief, editorialBrief);
});

test('a rendered record without actual slide text is still incomplete', async (t) => {
  mockRender(t);
  const db = database({ existing: [{ id: 12, status: 'draft', slides: [null], rendered_count: 1, content_format: 'single' }] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.is_existing, false);
});

test('explicit explainer input remains available for non-news editorial fixtures', async (t) => {
  const render = mockRender(t);
  const db = database({ topic: { summary: null, body: 'PUBLISHER_BODY_SENTINEL', image_url: 'https://img.antaranews.com/PUBLISHER_PHOTO_SENTINEL.jpg' } });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.slides_count, 6);
  const insert = db.sql.find(({ text }) => /INSERT INTO drafts\b/.test(text));
  assert.match(insert.text, /editorial_input, editorial_mode, caption_body, threads_caption, angle, scope_note/);
  assert.deepEqual(JSON.parse(insert.values[7]), { version: 1, mode: 'explainer', facts: [] });
  assert.equal(insert.values[8], 'explainer');
  assert.ok(insert.values[9].length >= 1200 && insert.values[9].length <= 1900);
  assert.ok(insert.values[10].length <= 500);
  assert.equal(insert.values[6], true);
  assert.equal(insert.values[5], null);
  assert.deepEqual(JSON.parse(insert.values[13]), {
    caption: originalFixture().caption_blocks.map(({ kind, fact_ids }) => ({ kind, fact_ids })), threads: [], article: [],
  });
  const audit = JSON.parse(db.sql.find(({ text }) => /INSERT INTO audit_log/.test(text)).values[2]);
  assert.deepEqual(audit.editorial_input, JSON.parse(insert.values[7]));
  assert.equal(audit.caption_body, insert.values[9]);
  assert.equal(audit.threads_caption, insert.values[10]);
  assert.equal(audit.angle, insert.values[11]);
  assert.equal(audit.scope_note, insert.values[12]);
  assert.deepEqual(audit.editorial_references, JSON.parse(insert.values[13]));
  assert.equal(audit.original_editorial_brief.mode, 'explainer');
  for (const { arguments: [, prompt] } of callAgentLLM.mock.calls) assert.doesNotMatch(prompt, /PUBLISHER_(?:BODY|PHOTO)_SENTINEL|Inflasi Oktober mencapai 2,1%/);
  assert.equal(render.mock.callCount(), 1);
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('generation failure rolls back without inserting a draft, quarantining old records or rendering', async (t) => {
  const render = mockRender(t);
  callAgentLLM.mock.mockImplementation(async () => { throw new Error('provider unavailable'); });
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft', slides: [], rendered_count: 0 }] });
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /original_generation_failed.*provider unavailable/);
  assert.equal(db.inserted, 0);
  assert.equal(render.mock.callCount(), 0);
  assert.ok(!db.sql.some(({ text }) => /^\s*(UPDATE|INSERT|DELETE)\b/i.test(text)));
  assert.equal(db.sql.at(-1).text, 'ROLLBACK');
});

test('regeneration provider failure leaves the previous revision and schedules unchanged before render', async (t) => {
  const render = mockRender(t);
  callAgentLLM.mock.mockImplementation(async () => { throw new Error('provider unavailable'); });
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft' }] });
  await assert.rejects(regenerateDraft(12, db.client), /original_generation_failed/);
  assert.equal(db.inserted, 0);
  assert.equal(render.mock.callCount(), 0);
  assert.ok(!db.sql.some(({ text }) => /SAVEPOINT regeneration|^\s*(UPDATE|INSERT|DELETE)\b/i.test(text)));
  assert.equal(db.sql.at(-1).text, 'ROLLBACK');
});

test('manual-first production may create a reviewed draft without an image, but cover gate remains downstream', async (t) => {
  config.designer = { image_generation: { enabled: true } };
  const render = mockRender(t);
  const db = database();
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.draft_id, 81);
  assert.equal(JSON.parse(db.sql.find(({ text }) => /INSERT INTO drafts/.test(text)).values[1])[0].data.asset_id, undefined);
  assert.equal(JSON.parse(db.sql.find(({ text }) => /INSERT INTO drafts/.test(text)).values[6]), true);
  assert.equal(callAgentLLM.mock.callCount(), 2);
  assert.equal(render.mock.callCount(), 1);
});

test('rendered legacy source-copy drafts are regenerated instead of silently reused for R6', async (t) => {
  const render = mockRender(t);
  const legacy = { id: 12, topic_id: 42, status: 'draft', content_format: 'carousel', rendered_count: 3, slides: [
    { no: 1, layout: 'cover-focus', teks: topic.title, data: {} },
    { no: 2, layout: 'big-statement', teks: topic.summary, data: {} },
    { no: 3, layout: 'big-statement', teks: 'Kutipan sumber lainnya.', data: {} },
  ] };
  const db = database({ topic: { status: 'produced' }, existing: [legacy] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.is_existing, false);
  assert.notEqual(result.draft_id, legacy.id);
  assert.equal(render.mock.callCount(), 1);
  assert.ok(db.sql.some(({ text, values }) => /UPDATE drafts SET status = 'failed'/.test(text) && values[0] === legacy.id));
});

const currentInput = () => ({ version: 1, mode: 'current', facts: [
  { id: 'f1', text: 'BPS mencatat inflasi tahunan sebesar 2,1%, ukuran perubahan harga konsumen dalam satu tahun.', source_url: 'https://www.bps.go.id/rilis/inflasi', source_name: 'BPS' },
  { id: 'f2', text: 'Angka inflasi membantu menjelaskan perubahan daya beli rumah tangga selama periode laporan.', source_url: 'https://www.bps.go.id/rilis/inflasi', source_name: 'BPS' },
  { id: 'f3', text: 'Perbandingan periode dan cakupan indeks perlu diperhatikan saat membaca data harga.', source_url: 'https://www.bps.go.id/rilis/inflasi', source_name: 'BPS' },
] });

test('regeneration restores stored editorial input without inferring facts from publisher summary', async (t) => {
  mockRender(t);
  const editorialInput = currentInput();
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft', editorial_input: editorialInput }] });
  await regenerateNewsDraft(12, db.client);
  const update = db.sql.find(({ text }) => /UPDATE drafts SET slides/.test(text));
  assert.deepEqual(JSON.parse(update.values[6]), editorialInput);
  assert.equal(update.values[7], 'current');
  assert.equal(JSON.parse(update.values[12]).caption[0].kind, 'fact');
  assert.deepEqual(JSON.parse(update.values[12]).caption[0].fact_ids, ['f1']);
  assert.match(update.text, /editorial_input = \$7, editorial_mode = \$8, caption_body = \$9, threads_caption = \$10, angle = \$11, scope_note = \$12/);
  const brief = JSON.parse(callAgentLLM.mock.calls.find(({ arguments: [agent] }) => agent === 'copywriter').arguments[1].split('ORIGINAL_EDITORIAL_JSON: ')[1]);
  assert.deepEqual(brief.facts, editorialInput.facts);
  assert.doesNotMatch(JSON.stringify(brief), /Inflasi Oktober mencapai 2,1%/);
});

test('explicit editorial input takes priority over stored regeneration input', async (t) => {
  mockRender(t);
  const db = database({ existing: [{ id: 12, topic_id: 42, status: 'draft', editorial_input: '{malformed legacy input' }] });
  await regenerateDraft(12, db.client, { editorialInput: { mode: 'explainer' } });
  const update = db.sql.find(({ text }) => /UPDATE drafts SET slides/.test(text));
  assert.deepEqual(JSON.parse(update.values[6]), { version: 1, mode: 'explainer', facts: [] });
  assert.equal(update.values[7], 'explainer');
});

test('invalid explicit original inputs fail before generation, rendering or draft writes', async (t) => {
  const render = mockRender(t);
  for (const editorialInput of [null, false, { mode: 'current', facts: [] }, { summary: 'PUBLISHER_SENTINEL' }, { mode: 'explainer', facts: currentInput().facts }]) {
    const db = database();
    await assert.rejects(produceSingleTopicDraft(topic, db.client, { editorialInput }), /original_editorial_input/);
    assert.equal(db.inserted, 0);
    assert.equal(db.sql.at(-1).text, 'ROLLBACK');
  }
  assert.equal(callAgentLLM.mock.callCount(), 0);
  assert.equal(render.mock.callCount(), 0);
});

test('regeneration preserves the local pinned illustration revision even when another asset is selected', async (t) => {
  const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-r6-copywriter-media-');
  t.after(() => fs.rm(storagePath, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#1f7e81' } }).png().toBuffer();
  const id = randomUUID();
  const raster = await saveIllustrationRaster(id, { bytes, mime: 'image/png' }, { storagePath });
  const asset = { ...raster, id, topic_id: 42, status: 'ready', kind: 'ai_generated', selected: false };
  const newlySelected = { ...asset, id: randomUUID(), selected: true };
  const existing = completeDraft();
  existing.slides[0].data = { ...existing.slides[0].data, asset_id: id, asset_sha256: asset.sha256, image_kind: 'ai_generated', disclosure_version: 1 };
  existing.slides = JSON.stringify(existing.slides);
  const db = database({ existing: [existing], assets: [asset, newlySelected] });
  mockRender(t, (request) => {
    assert.equal(request.slides[0].data.asset_id, id);
    assert.equal(request.slides[0].data.asset_sha256, asset.sha256);
    assert.match(request.slides[0].data.image_data, /^data:image\/png;base64,/);
    return { ok: true, json: async () => ({ rendered_slides: request.slides.map(({ no }) => ({ slide_no: no, file_path: `/test/${no}.png` })) }) };
  });
  await regenerateDraft(12, db.client, { imageOptions: { storagePath } });
  const slides = JSON.parse(db.sql.find(({ text }) => /UPDATE drafts SET slides/.test(text)).values[1]);
  assert.equal(slides[0].data.asset_id, id);
  assert.equal(slides[0].data.asset_sha256, asset.sha256);
  assert.equal(slides[0].data.image_data, undefined);
  assert.ok(!db.sql.some(({ text }) => /FROM media_assets.*selected AND status/s.test(text)), 'existing immutable cover wins over the current topic selection');
  for (const { arguments: [, prompt] } of callAgentLLM.mock.calls) {
    assert.ok(!prompt.includes(id));
    assert.ok(!prompt.includes(asset.sha256));
    assert.ok(!prompt.includes(newlySelected.id));
  }
});

test('regeneration preserves and hydrates an immutable manual cover and its credit', async (t) => {
  const storagePath = await fs.mkdtemp('/tmp/opencode/gapura-quality-manual-cover-');
  t.after(() => fs.rm(storagePath, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#1f7e81' } }).png().toBuffer();
  const id = randomUUID();
  const raster = await saveManualMediaRaster(id, bytes, { storagePath });
  const asset = { ...raster, id, topic_id: 42, kind: 'editor_upload', rights_basis: 'own_work', credit: 'Grafis redaksi', rights_reference: null };
  const existing = completeDraft();
  existing.slides[0].data = { ...existing.slides[0].data, asset_id: id, asset_sha256: asset.sha256,
    image_kind: 'editor_upload', credit: asset.credit, rights_basis: asset.rights_basis };
  const db = database({ existing: [existing], manualMediaAssets: [asset] });
  mockRender(t, (request) => {
    assert.equal(request.slides[0].data.image_kind, 'editor_upload');
    assert.equal(request.slides[0].data.credit, 'Grafis redaksi');
    assert.equal(request.slides[0].data.rights_basis, 'own_work');
    assert.match(request.slides[0].data.image_data, /^data:image\/jpeg;base64,/);
    return { ok: true, json: async () => ({ rendered_slides: request.slides.map(({ no }) => ({ slide_no: no, file_path: `/test/${no}.png` })) }) };
  });
  await regenerateDraft(12, db.client, { editorialInput: testExplainerInput, imageOptions: { storagePath } });
  const updated = JSON.parse(db.sql.find(({ text }) => /UPDATE drafts SET slides/.test(text)).values[1]);
  assert.equal(updated[0].data.asset_id, id);
  assert.equal(updated[0].data.asset_sha256, asset.sha256);
  assert.equal(updated[0].data.credit, 'Grafis redaksi');
});

test('reuse compares normalized curated facts, retaining JSONB key-order independence', async (t) => {
  const render = mockRender(t);
  const editorialInput = currentInput();
  const reordered = { facts: editorialInput.facts.map(({ id, text, source_url, source_name }) => ({ source_name, source_url, text, id })), mode: 'current' };
  const db = database({ topic: { status: 'produced' }, existing: [completeDraft({}, { editorialInput })] });
  const result = await produceSingleTopicDraft(topic, db.client, { editorialInput: reordered });
  assert.equal(result.is_existing, true);
  assert.equal(render.mock.callCount(), 0);
  assert.equal(callAgentLLM.mock.callCount(), 0);
});

test('changed curated facts create a new reviewed original instead of reusing another claim set', async (t) => {
  const render = mockRender(t);
  const previous = currentInput();
  const changed = currentInput(); changed.facts[0].text = 'BPS mencatat inflasi tahunan sebesar 2,2%.';
  const db = database({ topic: { status: 'produced' }, existing: [completeDraft({}, { editorialInput: previous })] });
  const result = await produceSingleTopicDraft(topic, db.client, { editorialInput: changed });
  assert.equal(result.is_existing, false);
  assert.equal(render.mock.callCount(), 1);
  const insert = db.sql.find(({ text }) => /INSERT INTO drafts\b/.test(text));
  assert.equal(JSON.parse(insert.values[7]).facts[0].text, changed.facts[0].text);
  assert.equal(insert.values[6], true);
});
