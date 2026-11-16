import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('dotenv', { defaultExport: { config() {} } });
mock.module('pg', { defaultExport: { Pool: class {} } });
mock.module('../../common/llm.js', { namedExports: {
  loadAgentsConfig: () => ({ analis: { min_score_threshold: 76 } }), loadAgentSkills: () => '',
  callAgentLLM: async () => { throw new Error('No live LLM in unit tests'); },
} });
const { produceSingleTopicDraft, regenerateDraft } = await import('../copywriter.js');
const topic = { id: 42, title: 'BPS merilis inflasi Oktober', summary: 'Inflasi Oktober mencapai 2,1%.', primary_source: 'BPS', url: 'https://www.bps.go.id/rilis/1', status: 'scored', verification_status: 'verified' };

function database(overrides = {}) {
  const sql = [];
  let releaseCount = 0;
  let inserted = 0;
  const client = {
    release() { releaseCount++; },
    async query(text, values = []) {
      sql.push({ text, values });
      if (/FROM topics\b/i.test(text)) return { rows: overrides.missingTopic ? [] : [{ ...topic, ...overrides.topic }] };
      if (/FROM topic_scores\b/i.test(text)) return { rows: overrides.score === null ? [] : [{ score_total: 88, verdict: 'passed', ...overrides.score }] };
      if (/FROM verification_reports\b/i.test(text)) return { rows: overrides.verification === null ? [] : [{ id: 7, topic_id: topic.id, status: 'verified', confidence: 90, ...overrides.verification }] };
      if (/FROM drafts\b/i.test(text)) return { rows: overrides.existing || [] };
      if (/FROM audit_log\b/i.test(text)) return { rows: overrides.audit || [] };
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

test('rejects missing, unscored, failed-scoring, unverified or hoax sources before spending on render', async (t) => {
  const render = mockRender(t);
  for (const [override, reason] of [
    [{ missingTopic: true }, /topic_not_found|sumber tidak ditemukan/i],
    [{ topic: { status: 'new' } }, /topic_not_scored/],
    [{ score: { score_total: 70 } }, /score_below_threshold/],
    [{ score: { verdict: 'rejected' } }, /score_not_passed/],
    [{ verification: null }, /verification_required/],
    [{ verification: { status: 'hoax_detected' }, existing: [{ id: 3 }] }, /hoax_detected/],
    [{ topic: { verification_status: 'hoax_detected' } }, /hoax_detected/],
  ]) {
    const db = database(override);
    await assert.rejects(produceSingleTopicDraft(topic, db.client), reason);
    assert.equal(db.inserted, 0);
  }
  assert.equal(render.mock.callCount(), 0);
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
  assert.ok(db.sql.some(({ text }) => /pg_advisory_xact_lock/.test(text)));
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

test('complete existing output is reused only after the latest source and verification gates pass', async (t) => {
  const render = mockRender(t);
  const db = database({ topic: { status: 'produced' }, existing: [{ id: 12, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.draft_id, 12);
  assert.equal(result.is_existing, true);
  assert.equal(render.mock.callCount(), 0);
  assert.ok(db.sql.some(({ text }) => /FROM verification_reports/.test(text)));
  assert.equal(db.sql.at(-1).text, 'COMMIT');
});

test('new Studio briefs create their own output rather than reusing another editorial job draft', async (t) => {
  const render = mockRender(t);
  const db = database({ topic: { status: 'produced' }, existing: [{ id: 12, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }] });
  const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true, editorialBrief: { job_id: 9, prompt: 'Ringkas', plan: { format: 'single', sections: ['Data', 'Sumber'] } } });
  assert.equal(result.is_existing, false);
  assert.notEqual(result.draft_id, 12);
  assert.equal(render.mock.callCount(), 1);
});

test('the same Studio brief retries its complete audited draft without rendering again', async (t) => {
  const render = mockRender(t);
  const editorialBrief = { job_id: 9, prompt: 'Ringkas', plan: { format: 'single', sections: ['Data', 'Sumber'] } };
  const db = database({ topic: { status: 'produced' }, existing: [{ id: 12, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }], audit: [{ entity_id: 12, payload: { editorial_brief: editorialBrief } }] });
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
  const db = database({ topic: { title: '', summary: '', primary_source: '' } });
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /source_evidence_required/);
  assert.equal(db.inserted, 0);
  assert.equal(render.mock.callCount(), 0);
});

test('audit JSONB key ordering does not break retry idempotency for a Studio brief', async (t) => {
  const render = mockRender(t);
  const editorialBrief = { job_id: 9, prompt: 'Ringkas', plan: { format: 'single', sections: ['Data', 'Sumber'] } };
  const storedBrief = { plan: { sections: ['Data', 'Sumber'], format: 'single' }, prompt: 'Ringkas', job_id: 9 };
  const db = database({ topic: { status: 'produced' }, existing: [{ id: 12, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], rendered_count: 1, content_format: 'single' }], audit: [{ entity_id: 12, payload: { editorial_brief: storedBrief } }] });
  const result = await produceSingleTopicDraft(topic, db.client, { forceReview: true, editorialBrief });
  assert.equal(result.is_existing, true);
  assert.equal(render.mock.callCount(), 0);
});

test('a newly recorded hoax while rendering prevents committing the draft as produced', async (t) => {
  const db = database();
  const query = db.client.query;
  let newlyHoax = false;
  db.client.query = async (text, values) => {
    if (/FROM verification_reports/.test(text) && newlyHoax) return { rows: [{ id: 8, topic_id: 42, status: 'hoax_detected', confidence: 95 }] };
    return query(text, values);
  };
  mockRender(t, (request) => {
    newlyHoax = true;
    return { ok: true, json: async () => ({ rendered_slides: request.slides.map((slide, index) => ({ slide_no: index + 1, layout: slide.layout, file_path: `/test/${index + 1}.png` })) }) };
  });
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /hoax_detected/);
  assert.equal(db.sql.at(-1).text, 'ROLLBACK');
});

test('an existing single draft containing two rendered slides is not considered complete', async (t) => {
  mockRender(t);
  const db = database({ existing: [{ id: 12, status: 'draft', slides: [{ no: 1, teks: topic.title }, { no: 2, teks: topic.summary }], rendered_count: 2, content_format: 'single' }] });
  const result = await produceSingleTopicDraft(topic, db.client);
  assert.equal(result.is_existing, false);
});

test('null verification confidence cannot masquerade as a complete latest verification report', async (t) => {
  const render = mockRender(t);
  const db = database({ verification: { confidence: null } });
  await assert.rejects(produceSingleTopicDraft(topic, db.client), /verification_invalid/);
  assert.equal(render.mock.callCount(), 0);
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
          completedDraft = { id: 81, status: 'draft', slides: [{ no: 1, layout: 'cover-focus', teks: topic.title }], content_format: 'single', rendered_count: 1 };
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
